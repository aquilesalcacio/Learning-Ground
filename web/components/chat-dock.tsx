"use client";

import { ChevronDown, Mic, MicOff, Send, Square } from "lucide-react";
import { type FormEvent, useEffect, useEffectEvent, useRef, useState } from "react";
import { BoardTools } from "@/components/board-tools";
import { CanvasLmsAssignmentBar } from "@/components/canvas-lms-assignment-bar";
import { pulseTutorOrb } from "@/components/tutor-orb";
import { TutorStage } from "@/components/tutor-stage";
import { UploadDialog } from "@/components/upload-dialog";
import { Button } from "@/components/ui/button";
import { onLgAnswerWritten, onLgHomeworkRead, onLgMarksDropped, onLgSelection } from "@/lib/lg-actions";
import { lgSelectionHasWork } from "@/lib/lg-board-link";
import {
  appendMessage,
  findBoardSelection,
  getActiveConversation,
  getActiveTutor,
  getConversationDocument,
  type LgState,
  readLgState,
  startConversation,
} from "@/lib/lg-store";
import { COLOR_HEX } from "@/lib/lg-types";
import { circledMessage, homeworkContextualUpdate } from "@/lib/lg-tutor-prompt";
import { homeworkContext, LgVoiceProvider, selectionContext, useLgVoice, useLgVoiceLevels } from "@/lib/lg-voice";

// After the student circles something, the tutor waits this long for them to say or type why.
const CIRCLE_WAIT_MS = 2000;
const MIC_CHECK_MS = 100;
// A microphone level above this, out of 1, is the student starting to talk.
const MIC_SPEAKING = 0.1;

// A circle belongs to the chat it was drawn in, because every chat numbers its spots from s1.
type PendingCircle = { id: string; conversation_id: string | null; message: string; at: number };

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
  // When the student last spoke or sent a message, so a circle they then ask about gets one reply.
  const lastStudentLine = useRef(0);
  const [circle, setCircle] = useState<PendingCircle | null>(null);
  // The latest circle drawn with no session to hear it. The next message the student sends
  // carries it as context, so "is this right?" is about that spot.
  const unheardCircle = useRef<PendingCircle | null>(null);
  const { getInputLevel } = useLgVoiceLevels();

  const voice = useLgVoice({
    onLine: (who, text) => {
      if (who === "student") lastStudentLine.current = Date.now();
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

  // The student wrote in the answer box of a question the tutor wrote, then paused: the tutor
  // checks it without being asked. With no session, nothing happens.
  const tellTutorAboutAnswer = useEffectEvent((question_id: string) => {
    if (!voice.connected) return;
    voice.sendWhenReady(`[Answer written] The student wrote an answer in the box for ${question_id}.`);
  });
  useEffect(() => onLgAnswerWritten((question_id) => tellTutorAboutAnswer(question_id)), []);

  // The tutor aimed marks at IDs that aren't on the board, so nothing was drawn. It hears so in the
  // background, with the IDs it can use, instead of believing it drew them.
  const tellTutorAboutDroppedMarks = useEffectEvent((message: string) => {
    voice.sendContextualUpdate(message);
  });
  useEffect(() => onLgMarksDropped((message) => tellTutorAboutDroppedMarks(message)), []);

  // The student circled or tapped something on the board. A live session hears about it at once,
  // as background, so whatever they say next is about it. If they then stay quiet, haven't typed
  // anything and don't start talking, the tutor is asked to react, starting a text chat if needed.
  const tellTutorAboutCircle = useEffectEvent((selection_id: string) => {
    const state = readLgState();
    const selection = findBoardSelection(state, selection_id);
    if (!selection) return;
    // A circle on the start screen began this chat, so a session started there belongs to it.
    if (status !== "idle") sessionConversation.current ??= state.active_conversation_id;
    const message = circledMessage(selectionContext(state, selection, lgSelectionHasWork(selection_id)));
    if (!message) return;
    const pending = { id: selection_id, conversation_id: state.active_conversation_id, message, at: Date.now() };
    unheardCircle.current = voice.sendContextualUpdate(message) ? null : pending;
    setCircle(pending);
  });

  // A circle still on this chat's board, or null once it's gone or another chat is open.
  function stillCircled(pending: PendingCircle | null) {
    const state = readLgState();
    if (!pending || state.active_conversation_id !== pending.conversation_id) return null;
    return findBoardSelection(state, pending.id) ? pending : null;
  }
  useEffect(() => onLgSelection((selection_id) => tellTutorAboutCircle(selection_id)), []);

  const micLevel = useEffectEvent(() => getInputLevel());
  const followUpCircle = useEffectEvent((pending: PendingCircle, heard: boolean) => {
    setCircle(null);
    if (heard || lastStudentLine.current >= pending.at || draft.trim()) return;
    // Gone if the board was cleared or another chat opened meanwhile.
    if (!stillCircled(pending)) return;
    if (status === "idle") beginSession(true);
    if (unheardCircle.current === pending) unheardCircle.current = null;
    voice.sendWhenReady(pending.message);
  });
  // A newer circle replaces the one still waiting, so only the latest gets a reply.
  useEffect(() => {
    if (!circle) return;
    let heard = false;
    const listen = setInterval(() => {
      if (micLevel() > MIC_SPEAKING) heard = true;
    }, MIC_CHECK_MS);
    const wait = setTimeout(() => {
      clearInterval(listen);
      followUpCircle(circle, heard);
    }, CIRCLE_WAIT_MS);
    return () => {
      clearInterval(listen);
      clearTimeout(wait);
    };
  }, [circle]);

  const messages = conversation?.messages ?? [];
  const streaming = voice.streamingLine;
  const active = status !== "idle";
  const connecting = status === "connecting";
  const onVoiceCall = active && !voice.textOnly;

  useEffect(() => {
    const element = transcript.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length, transcriptOpen, streaming.length]);

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
    // A circle no session heard goes first, so the tutor knows what "this" is.
    const unheard = stillCircled(unheardCircle.current);
    unheardCircle.current = null;
    if (unheard) voice.sendContextWhenReady(unheard.message);
    // The SDK only reports spoken student turns, so typed ones are added here.
    lastStudentLine.current = Date.now();
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
              {/* A text reply arrives word by word while the tutor draws. */}
              {streaming && (
                <p aria-live="off">
                  <span className="font-medium">{tutor.name || "Tutor"}: </span>
                  {streaming}
                  <span aria-hidden="true" className="ml-0.5 inline-block animate-pulse">
                    ▍
                  </span>
                </p>
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
