"use client";

import { ChevronDown, Mic, MicOff, Send, Square } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { BoardTools } from "@/components/board-tools";
import { TutorSwitcher } from "@/components/tutor-switcher";
import { UploadDialog } from "@/components/upload-dialog";
import { Button } from "@/components/ui/button";
import {
  appendMessage,
  getActiveConversation,
  getActiveTutor,
  type LgState,
  readLgState,
  setActiveTutor,
  startConversation,
} from "@/lib/lg-store";
import { COLOR_HEX } from "@/lib/lg-types";
import { LgVoiceProvider, useLgVoice } from "@/lib/lg-voice";

// The only chrome over the board: a tutor pill, the recent transcript, and one bar.
function Dock({ state }: { state: LgState }) {
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
    voice.addLine("student", text);
    voice.sendWhenReady(text);
    setDraft("");
  }

  function switchTutor(id: string) {
    const next = state.tutors.find((item) => item.id === id);
    if (!next || id === tutor.id) return;
    setActiveTutor(id);
    // A new tutor means a new session, so the old chat stays intact in history.
    sessionConversation.current = startConversation(id);
    voice.switchTutor(next, voice.textOnly);
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

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2 p-3">
      {messages.length > 0 && (
        <div className="pointer-events-auto w-full max-w-2xl">
          {transcriptOpen ? (
            <div
              ref={transcript}
              aria-label="Transcript"
              tabIndex={0}
              className="max-h-[32dvh] space-y-2 overflow-y-auto rounded-xl bg-background/85 p-3 text-sm shadow-sm ring-1 ring-foreground/10 backdrop-blur"
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
                variant="outline"
                size="sm"
                className="pointer-events-auto rounded-full shadow-sm"
                onClick={() => setTranscriptOpen(true)}
              >
                Show transcript ({messages.length})
              </Button>
            </div>
          )}
        </div>
      )}

      {voice.error && (
        <p
          role="alert"
          className="pointer-events-auto w-full max-w-2xl rounded-xl bg-background/95 px-3 py-2 text-sm text-destructive shadow-sm ring-1 ring-foreground/10 backdrop-blur"
        >
          {voice.error}
        </p>
      )}

      <div className="pointer-events-auto">
        <TutorSwitcher disabled={connecting} onSelect={switchTutor} />
      </div>

      <form
        onSubmit={send}
        className="pointer-events-auto flex w-full max-w-2xl items-center gap-1 rounded-full border bg-background/95 p-1.5 shadow-lg backdrop-blur"
      >
        <BoardTools />
        <UploadDialog />
        <input
          aria-label="Message your tutor"
          placeholder={`Ask ${tutor.name || "your tutor"} about this page`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
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

export function ChatDock({ state }: { state: LgState }) {
  return (
    <LgVoiceProvider>
      <Dock state={state} />
    </LgVoiceProvider>
  );
}
