"use client";

import { type ClientTools, ConversationProvider, useConversation } from "@elevenlabs/react";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { applyLgAction, type LgAction } from "./lg-actions";
import { checkStudentWork, type WorkCheck, workReport } from "./lg-check-work";
import { findVoice } from "./lg-voices";
import type { ChatSpeaker, Tutor } from "./lg-types";

// Temporary for the G1 test: a public agent needs only its ID. T-203 replaces this with a server token.
const AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? "";

export type LgVoiceStatus = "idle" | "connecting" | "listening" | "speaking";
type SessionRequest = { tutor: Tutor; textOnly: boolean };

const CHECK_STATUS_LABEL: Record<WorkCheck["status"], string> = {
  correct: "looks right",
  incomplete: "right so far, not finished",
  error: "there's something to fix",
  blank: "no math found",
  unreadable: "couldn't read it",
};

function act(name: string, parameters: Record<string, unknown>, action: LgAction) {
  // Timestamps feed the latency targets Q-01 and Q-02 in the technical scope.
  console.log(`[lg-voice] ${new Date().toISOString()} tool ${name}`, parameters);
  applyLgAction(action);
}

const text = (value: unknown) => String(value ?? "");

// Names and parameters must match api/voice/tools.json exactly.
const clientTools: ClientTools = {
  focus_region: (p) => act("focus_region", p, { type: "focus_region", region_id: text(p.region_id) }),
  circle_region: (p) => act("circle_region", p, { type: "circle_region", region_id: text(p.region_id) }),
  draw_arrow: (p) =>
    act("draw_arrow", p, {
      type: "draw_arrow",
      from_region_id: text(p.from_region_id),
      to_region_id: text(p.to_region_id),
      label: p.label ? text(p.label) : undefined,
    }),
  write_text: (p) => act("write_text", p, { type: "write_text", near_region_id: text(p.near_region_id), text: text(p.text) }),
  write_math: (p) => act("write_math", p, { type: "write_math", near_region_id: text(p.near_region_id), latex: text(p.latex) }),
  clear: (p) => act("clear", p, { type: "clear" }),
  // The only blocking tool: the tutor waits for this answer before it replies.
  read_student_work: async (p) => {
    console.log(`[lg-voice] ${new Date().toISOString()} tool read_student_work`, p);
    const outcome = await checkStudentWork(text(p.region_id));
    console.log(`[lg-voice] ${new Date().toISOString()} read_student_work done`, outcome.ok);
    return outcome.ok ? workReport(outcome) : outcome.message;
  },
};

function sessionOptions({ tutor, textOnly }: SessionRequest) {
  const voice = tutor.language ? findVoice(tutor.language, tutor.voice_id) : undefined;
  return {
    agentId: AGENT_ID,
    textOnly,
    // Unset fields are left out: a blank voice uses that language's default on the agent.
    overrides: {
      ...(tutor.language ? { agent: { language: tutor.language } } : {}),
      ...(voice ? { tts: { voiceId: voice.voice_id } } : {}),
    },
  };
}

export function LgVoiceProvider({ children }: { children: ReactNode }) {
  return <ConversationProvider clientTools={clientTools}>{children}</ConversationProvider>;
}

// UI-free session state for the voice dock. Must be used inside LgVoiceProvider.
// Every line of the session goes to onLine, which keeps the record of it.
export function useLgVoice({ onLine }: { onLine: (who: ChatSpeaker, text: string) => void }) {
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [textOnly, setTextOnly] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const restart = useRef<SessionRequest | null>(null);
  const pendingText = useRef<string[]>([]);

  const conversation = useConversation({
    onMessage: ({ message, role }) => onLine(role === "user" ? "student" : "tutor", message),
    onConnect: () => {
      for (const message of pendingText.current) conversation.sendUserMessage(message);
      pendingText.current = [];
    },
    onError: (message) => {
      console.error("[lg-voice]", message);
      pendingText.current = [];
      setError(message);
    },
    onModeChange: ({ mode }) => console.log(`[lg-voice] ${new Date().toISOString()} mode ${mode}`),
    onDisconnect: () => {
      const next = restart.current;
      restart.current = null;
      setRestarting(false);
      // Language is fixed for a call, so a tutor switch ends the session and starts a new one.
      if (next) {
        conversation.startSession(sessionOptions(next));
      } else {
        pendingText.current = [];
        onLine("system", "Session ended.");
      }
    },
  });

  const { endSession } = conversation;
  const connected = conversation.status === "connected";

  const status: LgVoiceStatus = connected
    ? conversation.isSpeaking
      ? "speaking"
      : "listening"
    : conversation.status === "connecting" || restarting
      ? "connecting"
      : "idle";

  // Returns false when no session could be started.
  function start(tutor: Tutor, nextTextOnly: boolean) {
    if (!AGENT_ID) {
      setError("NEXT_PUBLIC_ELEVENLABS_AGENT_ID is missing from web/.env.local.");
      return false;
    }
    setError("");
    setTextOnly(nextTextOnly);
    onLine("system", `Session started with ${tutor.name || "Unnamed tutor"}.`);
    conversation.startSession(sessionOptions({ tutor, textOnly: nextTextOnly }));
    return true;
  }

  // Check my work. With a session, the tutor responds; without one, the hint goes on the board.
  async function checkWork(region_id: string) {
    if (checking) return;
    setChecking(true);
    const outcome = await checkStudentWork(region_id);
    setChecking(false);
    if (!outcome.ok) {
      onLine("system", outcome.message);
      return;
    }
    onLine("system", `Checked ${outcome.label}: ${CHECK_STATUS_LABEL[outcome.check.status]}.`);
    if (connected) {
      conversation.sendUserMessage(`[Check my work]\n${workReport(outcome)}`);
    } else if (outcome.check.hint) {
      onLine("system", outcome.check.hint);
      applyLgAction({ type: "write_text", near_region_id: region_id, text: outcome.check.hint });
    }
  }

  // Replaces the live session, because tutor, language and text-only mode are fixed for a call.
  function restartSession(tutor: Tutor, nextTextOnly: boolean) {
    setError("");
    setTextOnly(nextTextOnly);
    setRestarting(true);
    restart.current = { tutor, textOnly: nextTextOnly };
    endSession();
  }

  function switchTutor(tutor: Tutor, nextTextOnly: boolean) {
    pendingText.current = [];
    if (status === "idle") return;
    restartSession(tutor, nextTextOnly);
  }

  // Sends now, or as soon as the session that is still connecting opens.
  function sendWhenReady(message: string) {
    if (connected) conversation.sendUserMessage(message);
    else pendingText.current.push(message);
  }

  const end = useCallback(() => {
    restart.current = null;
    pendingText.current = [];
    setRestarting(false);
    endSession();
  }, [endSession]);

  return {
    status,
    connected,
    textOnly,
    error,
    checking,
    checkWork,
    start,
    restartSession,
    switchTutor,
    end,
    sendWhenReady,
    muted: conversation.isMuted,
    setMuted: conversation.setMuted,
  };
}
