"use client";

import {
  type ClientTools,
  ConversationProvider,
  useConversation,
  useConversationControls,
  useConversationMode,
  useConversationStatus,
} from "@elevenlabs/react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { applyLgAction, askLgQuestion, doneLookingAtLgWork, type LgAction, lookAtLgWork } from "./lg-actions";
import { LgApiAuthError, lgApiFetch } from "./lg-api";
import { checkStudentWork, type WorkCheck, type WorkCheckOutcome, workReport } from "./lg-check-work";
import { apiErrorMessage } from "./lg-document";
import { parseNumber, parseNumberLineMarks } from "./lg-ink";
import { runStudentProgress } from "./lg-progress-run";
import { getActiveConversation, getActiveDocument, getBoardQuestions, readLgState } from "./lg-store";
import { penInterrupted, setPenVoice } from "./lg-tutor-pen";
import { buildTutorPrompt, type LgHomeworkContext, resolveLanguage, toneVoiceSettings } from "./lg-tutor-prompt";
import { findVoice } from "./lg-voices";
import type { ChatSpeaker, LgDocument, Tutor } from "./lg-types";

const SILENT_TURN = /^[\s.…]*$/;

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

// Check my work, with the tutor's pen hovering over the work while Gemini reads it, and
// celebrating when it's right.
async function checkWithPen(region_id: string): Promise<WorkCheckOutcome> {
  lookAtLgWork(region_id);
  const outcome = await checkStudentWork(region_id);
  doneLookingAtLgWork(outcome.ok && outcome.check.status === "correct");
  return outcome;
}

// Names and parameters must match api/voice/tools.json exactly.
const clientTools: ClientTools = {
  focus_region: (p) => act("focus_region", p, { type: "focus_region", region_id: text(p.region_id) }),
  point_at: (p) => act("point_at", p, { type: "point_at", region_id: text(p.region_id) }),
  circle_region: (p) => act("circle_region", p, { type: "circle_region", region_id: text(p.region_id) }),
  underline_region: (p) => act("underline_region", p, { type: "underline_region", region_id: text(p.region_id) }),
  highlight_region: (p) => act("highlight_region", p, { type: "highlight_region", region_id: text(p.region_id) }),
  draw_arrow: (p) =>
    act("draw_arrow", p, {
      type: "draw_arrow",
      from_region_id: text(p.from_region_id),
      to_region_id: text(p.to_region_id),
      label: p.label ? text(p.label) : undefined,
    }),
  write_text: (p) => act("write_text", p, { type: "write_text", near_region_id: text(p.near_region_id), text: text(p.text) }),
  write_math: (p) => act("write_math", p, { type: "write_math", near_region_id: text(p.near_region_id), latex: text(p.latex) }),
  number_line: (p) =>
    act("number_line", p, {
      type: "number_line",
      near_region_id: text(p.near_region_id),
      min: parseNumber(text(p.min)),
      max: parseNumber(text(p.max)),
      marks: parseNumberLineMarks(p.marks ? text(p.marks) : ""),
    }),
  clear: (p) => act("clear", p, { type: "clear" }),
  // Answers at once with the question's ID, which the tutor needs to check the answer later.
  ask_question: (p) => {
    console.log(`[lg-voice] ${new Date().toISOString()} tool ask_question`, p);
    const outcome = askLgQuestion(text(p.question), p.near_region_id ? text(p.near_region_id) : "");
    if (!outcome.ok) return outcome.message;
    return [
      `Question ${outcome.id} is being written on the board, with an answer box under it.`,
      `Set it up on ${outcome.id} with one board tool in this same reply, then stop and let the student answer. Don't give the answer.`,
      `To check their answer, call read_student_work with region_id ${outcome.id}. You can also mark it with your other tools using ${outcome.id}.`,
    ].join(" ");
  },
  // Blocking: the tutor waits for this answer before it replies.
  read_student_work: async (p) => {
    console.log(`[lg-voice] ${new Date().toISOString()} tool read_student_work`, p);
    const outcome = await checkWithPen(text(p.region_id));
    console.log(`[lg-voice] ${new Date().toISOString()} read_student_work done`, outcome.ok);
    return outcome.ok ? workReport(outcome) : outcome.message;
  },
  // Blocking too: Canvas LMS gets about 4 s, then the saved profile is used.
  get_student_progress: async () => {
    console.log(`[lg-voice] ${new Date().toISOString()} tool get_student_progress`);
    const report = await runStudentProgress();
    console.log(`[lg-voice] ${new Date().toISOString()} get_student_progress done`);
    return report;
  },
};

// What the student sees of a reply while it streams in: no audio tags such as [laughs], and no
// half-written tag at the end. Tags are words only, so math such as [0, 1] stays.
function visibleText(line: string) {
  return line
    .replace(/\[[a-zA-Z\u00C0-\u024F][a-zA-Z\u00C0-\u024F ]{0,28}\]\s?/g, "")
    .replace(/\[[a-zA-Z\u00C0-\u024F ]*$/, "")
    .trimStart();
}

// A chat's homework, as the tutor prompt sees it: the regions read from its pages, with the
// text Gemini read. A page with no problems found is one p{n}.page region holding the page's text.
// Null when no homework is open, so the prompt tells the tutor not to claim any marks.
export function homeworkContext(document: LgDocument | null): LgHomeworkContext | null {
  if (!document) return null;
  const regions = document.regions.map(({ region_id, label, text }) => ({ region_id, label, text }));
  return { filename: document.filename, regions };
}

// Each session starts from a one-time credential that our API gets from ElevenLabs (T-203). The agent
// requires auth, so its ID alone starts nothing, and the API key never reaches the browser.
// A voice call gets a conversation token (WebRTC), a text chat a signed URL (WebSocket).
type SessionCredential = { conversationToken: string } | { signedUrl: string };

const START_FAILED = "The tutor couldn't start. Please try again.";

// A credential, or the message to show when there's none.
async function sessionCredential(textOnly: boolean): Promise<SessionCredential | string> {
  try {
    const response = await lgApiFetch("/voice/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text_only: textOnly }),
    });
    if (!response.ok) return await apiErrorMessage(response, START_FAILED);
    const body = (await response.json()) as { conversation_token?: string | null; signed_url?: string | null };
    if (textOnly && body.signed_url) return { signedUrl: body.signed_url };
    if (!textOnly && body.conversation_token) return { conversationToken: body.conversation_token };
    return START_FAILED;
  } catch (error) {
    if (error instanceof LgApiAuthError) return error.message;
    return "The tutor can't reach the server. Check your connection and try again.";
  }
}

// Read when each session starts, so tutor edits, the profile and homework apply to the next one.
function sessionOptions({ tutor, textOnly }: SessionRequest, credential: SessionCredential) {
  const state = readLgState();
  const language = resolveLanguage(tutor, state.profile);
  const voice = findVoice(language, tutor.voice_id);
  const prompt = buildTutorPrompt(
    tutor,
    state.profile,
    homeworkContext(getActiveDocument(state)),
    getActiveConversation(state)?.canvas_lms_assignment ?? null,
    getBoardQuestions(state).map(({ id, text: question }) => ({ id, text: question })),
  );
  return {
    ...credential,
    textOnly,
    // Tags such as [laughs] are spoken as expression and never shown in the transcript.
    stripAudioTags: true,
    // Every field sent here must be allowed in the agent's overrides (elevenlabs_setup.py),
    // or the session fails. A blank voice uses that language's default on the agent.
    overrides: {
      agent: { language, prompt: { prompt } },
      tts: { ...(voice ? { voiceId: voice.voice_id } : {}), ...toneVoiceSettings(tutor) },
    },
  };
}

export function LgVoiceProvider({ children }: { children: ReactNode }) {
  return <ConversationProvider clientTools={clientTools}>{children}</ConversationProvider>;
}

// Read-only: what the tutor orb needs to move with the session. It never starts, ends or changes
// a session, so it can sit anywhere inside LgVoiceProvider next to the component using useLgVoice.
// The getters return 0 to 1, and 0 when no session is live; call them each animation frame.
export function useLgVoiceLevels() {
  const { status } = useConversationStatus();
  const { isSpeaking } = useConversationMode();
  const { getOutputVolume, getInputVolume } = useConversationControls();
  const live = status === "connected";
  return {
    live,
    speaking: live && isSpeaking,
    getOutputLevel: getOutputVolume,
    getInputLevel: getInputVolume,
  };
}

// UI-free session state for the voice dock. Must be used inside LgVoiceProvider.
// Every line of the session goes to onLine, which keeps the record of it.
export function useLgVoice({ onLine }: { onLine: (who: ChatSpeaker, text: string) => void }) {
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [textOnly, setTextOnly] = useState(false);
  const [restarting, setRestarting] = useState(false);
  // Waiting for the API's credential, before the SDK starts connecting.
  const [preparing, setPreparing] = useState(false);
  // Counts session starts, so a start that was ended, replaced or left behind while it was still
  // preparing never opens.
  const attempt = useRef(0);
  // A text-only reply as it streams in, before onMessage records it.
  const [streamingLine, setStreamingLine] = useState("");
  const restart = useRef<SessionRequest | null>(null);
  const pendingText = useRef<string[]>([]);
  // Contextual updates that arrived while a session was connecting. Its prompt was already built.
  const pendingContext = useRef<string[]>([]);

  const conversation = useConversation({
    onMessage: ({ message, role }) => {
      if (role !== "user") setStreamingLine("");
      // After each turn timeout of silence, ElevenLabs logs a student turn of "...". It isn't speech.
      if (!message.trim() || (role === "user" && SILENT_TURN.test(message))) return;
      onLine(role === "user" ? "student" : "tutor", message);
    },
    // In a text chat, the reply appears word by word while the tutor's pen draws. A voice call
    // keeps whole lines, so the transcript never runs ahead of the voice.
    onAgentChatResponsePart: ({ text: part, type }) => {
      if (!textOnly) return;
      if (type === "start") setStreamingLine("");
      else if (type === "delta") setStreamingLine((line) => line + part);
    },
    // The pen waits for the tutor's voice, and speeds up when the student talks over it.
    onInterruption: () => penInterrupted(),
    onConnect: () => {
      setPenVoice({ live: true, speaking: false, level: () => conversation.getOutputVolume() });
      for (const message of pendingContext.current) conversation.sendContextualUpdate(message);
      pendingContext.current = [];
      for (const message of pendingText.current) conversation.sendUserMessage(message);
      pendingText.current = [];
    },
    onError: (message) => {
      console.error("[lg-voice]", message);
      setStreamingLine("");
      pendingText.current = [];
      pendingContext.current = [];
      setError(message);
    },
    onModeChange: ({ mode }) => {
      console.log(`[lg-voice] ${new Date().toISOString()} mode ${mode}`);
      setPenVoice({ speaking: mode === "speaking" });
    },
    onDisconnect: () => {
      setPenVoice({ live: false, speaking: false });
      setStreamingLine("");
      const next = restart.current;
      restart.current = null;
      setRestarting(false);
      // Language is fixed for a call, so a tutor switch ends the session and starts a new one.
      if (next) {
        void launch(next);
      } else {
        pendingText.current = [];
        pendingContext.current = [];
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
    : conversation.status === "connecting" || restarting || preparing
      ? "connecting"
      : "idle";

  // A dock that goes away mid-start leaves that start behind.
  useEffect(
    () => () => {
      attempt.current += 1;
    },
    [],
  );

  // Gets a credential from the API, then opens the session. A failure shows as the error, and
  // drops what was waiting to be sent.
  async function launch(request: SessionRequest) {
    attempt.current += 1;
    const mine = attempt.current;
    setPreparing(true);
    const credential = await sessionCredential(request.textOnly);
    if (mine !== attempt.current) return;
    setPreparing(false);
    if (typeof credential === "string") {
      pendingText.current = [];
      pendingContext.current = [];
      setError(credential);
      return;
    }
    conversation.startSession(sessionOptions(request, credential));
  }

  // Always true: a session that can't start shows its error instead. Kept for the dock, which
  // keeps a typed draft only when this returns false.
  function start(tutor: Tutor, nextTextOnly: boolean) {
    setError("");
    setTextOnly(nextTextOnly);
    setPenVoice({ textOnly: nextTextOnly });
    onLine("system", `Session started with ${tutor.name || "Unnamed tutor"}.`);
    void launch({ tutor, textOnly: nextTextOnly });
    return true;
  }

  // Check my work. With a session, the tutor responds; without one, the hint goes on the board.
  async function checkWork(region_id: string) {
    if (checking) return;
    setChecking(true);
    const outcome = await checkWithPen(region_id);
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
    setPenVoice({ textOnly: nextTextOnly });
    // Still waiting for a credential: there's no session to end yet, so this one starts instead.
    if (preparing) {
      void launch({ tutor, textOnly: nextTextOnly });
      return;
    }
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

  // Background information for the live session, such as homework opened mid-session
  // (build it with homeworkContextualUpdate). The tutor doesn't reply to it. Without a
  // session it's dropped: the next session's prompt reads the homework anyway. A session
  // still connecting gets it once it opens, because its prompt was built before this arrived.
  function sendContextualUpdate(message: string) {
    if (connected) conversation.sendContextualUpdate(message);
    else if (status === "connecting") pendingContext.current.push(message);
    else return false;
    return true;
  }

  const end = useCallback(() => {
    attempt.current += 1;
    restart.current = null;
    pendingText.current = [];
    pendingContext.current = [];
    setRestarting(false);
    setPreparing(false);
    endSession();
  }, [endSession]);

  return {
    status,
    connected,
    textOnly,
    streamingLine: visibleText(streamingLine),
    error,
    checking,
    checkWork,
    start,
    restartSession,
    switchTutor,
    end,
    sendWhenReady,
    sendContextualUpdate,
    muted: conversation.isMuted,
    setMuted: conversation.setMuted,
  };
}
