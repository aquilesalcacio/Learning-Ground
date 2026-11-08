"use client";

import { ChevronDown, Mic, MicOff, Send, Square } from "lucide-react";
import { type FormEvent, useEffect, useEffectEvent, useRef, useState } from "react";
import { BoardTools } from "@/components/board-tools";
import { CanvasLmsAssignmentBar } from "@/components/canvas-lms-assignment-bar";
import { pulseTutorOrb } from "@/components/tutor-orb";
import { TutorStage } from "@/components/tutor-stage";
import { UploadDialog } from "@/components/upload-dialog";
import { Button } from "@/components/ui/button";
import { onLgHomeworkRead } from "@/lib/lg-actions";
import {
  appendMessage,
  getActiveConversation,
  getActiveTutor,
  getConversationDocument,
  type LgState,
  readLgState,
  startConversation,
} from "@/lib/lg-store";
import { COLOR_HEX } from "@/lib/lg-types";
import { homeworkContextualUpdate } from "@/lib/lg-tutor-prompt";
import { homeworkContext, LgVoiceProvider, useLgVoice } from "@/lib/lg-voice";

// The only chrome over the board besides the orb: the recent transcript and one glass bar.
// Everything the student asks goes through this bar or their voice.
function Dock({ state, boardId }: { state: LgState; boardId: string }) {
  const tutor = getActiveTutor(state);
  const conversation = getActiveConversation(state);
  const [draft, setDraft] = useState("");
  const [transcriptOpen, setTranscriptOpen] = useState(true);
  const transcript = useRef<HTMLDivElement>(null);
  // A session belongs to the chat it started in, whichever chat is on screen when a line arrives.
  const sessionConversation = useRef<string | null>(null);

  const voice = useLgVoice({
    onLine: (who, text) => {
      sessionConversation.current ??= startConversation();
      appendMessage(sessionConversation.current, who, text);
      setTranscriptOpen(true);
    },
  });
  const { status, end } = voice;

  // Homework read during a live session reaches the tutor as background context. A session
  // started later reads it from its prompt instead.
  const tellTutorAboutHomework = useEffectEvent((conversation_id: string) => {
    if (conversation_id !== sessionConversation.current) return;
    const homework = homeworkContext(getConversationDocument(readLgState(), conversation_id));
    if (homework) voice.sendContextualUpdate(homeworkContextualUpdate(homework));
  });
  useEffect(() => onLgHomeworkRead((conversation_id) => tellTutorAboutHomework(conversation_id)), []);

  const messages = conversation?.messages ?? [];
  const active = status !== "idle";
  const connecting = status === "connecting";
  const onVoiceCall = active && !voice.textOnly;

  useEffect(() => {
    const element = transcript.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length, transcriptOpen]);

  // Opening another chat, starting a new one or deleting this one all leave the session behind.
  const activeConversationId = state.active_conversation_id;
  useEffect(() => {
    const pinned = sessionConversation.current;
    if (status !== "idle" && pinned && activeConversationId !== pinned) end();
  }, [activeConversationId, status, end]);

  function beginSession(textOnly: boolean) {
    sessionConversation.current = readLgState().active_conversation_id;
    return voice.start(tutor, textOnly);
  }

  function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    // Typing needs no setup: the first message opens a text session. The draft stays if that fails.
    if (status === "idle" && !beginSession(true)) return;
    // The SDK only reports spoken student turns, so typed ones are added here.
    sessionConversation.current ??= startConversation();
    appendMessage(sessionConversation.current, "student", text);
    setTranscriptOpen(true);
    voice.sendWhenReady(text);
    setDraft("");
  }

  function startVoice() {
    if (active) voice.restartSession(tutor, false);
    else beginSession(false);
  }

  const statusLabel = connecting
    ? "Connecting"
    : voice.textOnly
      ? "Text chat"
      : voice.muted
        ? "Muted"
        : status === "speaking"
          ? "Speaking"
          : "Listening";

  // Once the orb docks in the corner, narrow screens make room for it beside the bar.
  const working = !!state.active_conversation_id;

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 p-3 transition-[padding] duration-500 ease-soft ${
        working ? "@max-4xl:pl-[5.25rem]" : ""
      }`}
    >
      {conversation?.canvas_lms_assignment && (
        <CanvasLmsAssignmentBar key={conversation.id} conversation={conversation} tutorName={tutor.name} />
      )}
      {messages.length > 0 && (
        <div className="pointer-events-auto w-full max-w-2xl">
          {transcriptOpen ? (
            <div
              ref={transcript}
              aria-label="Transcript"
              tabIndex={0}
              className="glass max-h-[32dvh] space-y-2 overflow-y-auto rounded-3xl p-3 px-4 text-sm"
            >
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Hide transcript"
                  onClick={() => setTranscriptOpen(false)}
                >
                  <ChevronDown />
                </Button>
              </div>
              {messages.map((message) =>
                message.who === "system" ? (
                  <p key={message.id} className="text-xs text-muted-foreground">
                    {message.text}
                  </p>
                ) : (
                  <p key={message.id}>
                    <span className="font-medium">
                      {message.who === "student" ? "You" : tutor.name || "Tutor"}:{" "}
                    </span>
                    {message.text}
                  </p>
                ),
              )}
            </div>
          ) : (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="glass pointer-events-auto rounded-full"
                onClick={() => setTranscriptOpen(true)}
              >
                Show transcript ({messages.length})
              </Button>
            </div>
          )}
        </div>
      )}

      {voice.error && (
        <p role="alert" className="glass pointer-events-auto w-full max-w-2xl rounded-2xl px-4 py-2 text-sm text-destructive">
          {voice.error}
        </p>
      )}

      <form
        onSubmit={send}
        className="glass pointer-events-auto flex w-full max-w-2xl items-center gap-1 rounded-full p-1.5"
      >
        {/* Keyed so the menu's color and background start fresh along with each chat's board. */}
        <BoardTools key={boardId} />
        <UploadDialog />
        <input
          aria-label="Message your tutor"
          placeholder={`Ask ${tutor.name || "your tutor"}${conversation?.document ? " about this page" : " anything"}`}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            // The orb notices the student typing.
            pulseTutorOrb(0.12);
          }}
          className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
        />
        {active && (
          <span className="flex shrink-0 items-center gap-1.5 pr-1 text-xs text-muted-foreground" aria-live="polite">
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{ backgroundColor: COLOR_HEX[tutor.color] }}
            />
            {statusLabel}
          </span>
        )}
        {onVoiceCall ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={voice.muted ? "Unmute microphone" : "Mute microphone"}
            aria-pressed={voice.muted}
            disabled={connecting}
            className="shrink-0 rounded-full"
            onClick={() => voice.setMuted(!voice.muted)}
          >
            {voice.muted ? <MicOff /> : <Mic />}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Start voice session"
            disabled={connecting}
            className="shrink-0 rounded-full"
            onClick={startVoice}
          >
            <Mic />
          </Button>
        )}
        {active && (
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label="End session"
            disabled={connecting}
            className="shrink-0 rounded-full"
            onClick={end}
          >
            <Square />
          </Button>
        )}
        <Button type="submit" size="icon" aria-label="Send message" className="shrink-0 rounded-full">
          <Send />
        </Button>
      </form>
    </div>
  );
}

export function ChatDock({ state, boardId }: { state: LgState; boardId: string }) {
  // Next keeps this page alive but hidden while the student is on another page. The session
  // ends then and the SDK stops tracking it, so its status would stay stuck on "connected".
  // Remounting gives each return a clean dock, including its menus.
  const [visit, setVisit] = useState(0);
  useEffect(() => () => setVisit((current) => current + 1), []);

  return (
    <LgVoiceProvider key={visit}>
      <TutorStage state={state} />
      <Dock state={state} boardId={boardId} />
    </LgVoiceProvider>
  );
}
