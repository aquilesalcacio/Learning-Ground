"use client";

import { type ClientTools, ConversationProvider, useConversation } from "@elevenlabs/react";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { applyLgAction, type LgAction } from "./lg-actions";
import { findVoice } from "./lg-voices";
import type { Tutor } from "./lg-types";

// Temporary for the G1 test: a public agent needs only its ID. T-203 replaces this with a server token.
const AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? "";

export type LgVoiceStatus = "idle" | "connecting" | "listening" | "speaking";
export type LgVoiceLine = { id: number; who: "student" | "tutor" | "system"; text: string };
type SessionRequest = { tutor: Tutor; textOnly: boolean };

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
// onLine lets a caller keep its own record of the session, such as the chat history.
export function useLgVoice({ onLine }: { onLine?: (who: LgVoiceLine["who"], text: string) => void } = {}) {
  const [lines, setLines] = useState<LgVoiceLine[]>([]);
  const [error, setError] = useState("");
  const [textOnly, setTextOnly] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const nextLineId = useRef(0);
  const restart = useRef<SessionRequest | null>(null);
  const pendingText = useRef<string[]>([]);

  function addLine(who: LgVoiceLine["who"], line: string) {
    const id = nextLineId.current++;
    setLines((current) => [...current, { id, who, text: line }]);
    onLine?.(who, line);
  }

  const conversation = useConversation({
    onMessage: ({ message, role }) => addLine(role === "user" ? "student" : "tutor", message),
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
        addLine("system", "Session ended.");
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
    addLine("system", `Session started with ${tutor.name || "Unnamed tutor"}.`);
    conversation.startSession(sessionOptions({ tutor, textOnly: nextTextOnly }));
    return true;
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
    const name = tutor.name || "Unnamed tutor";
    pendingText.current = [];
    setLines([{ id: nextLineId.current++, who: "system", text: `Switched to ${name}. New session.` }]);
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
    lines,
    error,
    addLine,
    start,
    restartSession,
    switchTutor,
    end,
    sendText: conversation.sendUserMessage,
    sendWhenReady,
    muted: conversation.isMuted,
    setMuted: conversation.setMuted,
  };
}
