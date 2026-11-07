"use client";

import { Mic, MicOff, Send } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { FieldSelect, MockBadge } from "@/components/lg-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getActiveTutor, setActiveTutor, useLgState } from "@/lib/lg-store";
import { COLOR_HEX } from "@/lib/lg-types";

type Status = "idle" | "listening" | "speaking";
type Line = { id: number; who: "student" | "tutor" | "system"; text: string };

const STATUS_LABEL: Record<Status, string> = {
  idle: "Not connected",
  listening: "Listening",
  speaking: "Tutor speaking",
};

const MOCK_REPLY_MS = 1200;

// One conversation component for Learning Grounds and Chat (vision doc, section 8.2).
// Mocked: nothing here reaches ElevenLabs, and the browser microphone is never requested.
export function ConversationPanel({
  checkWorkTarget,
  footer,
}: {
  checkWorkTarget?: string;
  footer?: ReactNode;
}) {
  const state = useLgState();
  const tutor = getActiveTutor(state);
  const [status, setStatus] = useState<Status>("idle");
  const [voiceOn, setVoiceOn] = useState(true);
  const [muted, setMuted] = useState(false);
  const [draft, setDraft] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const nextLineId = useRef(0);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcript = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (replyTimer.current) clearTimeout(replyTimer.current);
    };
  }, []);

  useEffect(() => {
    const element = transcript.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines]);

  function addLine(who: Line["who"], text: string) {
    const id = nextLineId.current++;
    setLines((current) => [...current, { id, who, text }]);
  }

  function mockTutorReply(text: string) {
    if (replyTimer.current) clearTimeout(replyTimer.current);
    setStatus("speaking");
    replyTimer.current = setTimeout(() => {
      addLine("tutor", text);
      setStatus("listening");
    }, MOCK_REPLY_MS);
  }

  function toggleSession() {
    if (status === "idle") {
      setStatus("listening");
      addLine("system", `Session started with ${tutor.name || "Unnamed tutor"}.`);
      return;
    }
    if (replyTimer.current) clearTimeout(replyTimer.current);
    setStatus("idle");
    addLine("system", "Session ended.");
  }

  function switchTutor(id: string) {
    if (replyTimer.current) clearTimeout(replyTimer.current);
    setActiveTutor(id);
    const name = state.tutors.find((item) => item.id === id)?.name || "Unnamed tutor";
    // Switching ends the session and starts a new one, so the transcript starts over.
    setLines([{ id: nextLineId.current++, who: "system", text: `Switched to ${name}. New session.` }]);
    setStatus((current) => (current === "idle" ? "idle" : "listening"));
  }

  function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    addLine("student", text);
    setDraft("");
    mockTutorReply("[Mocked reply: the tutor's answer appears here.]");
  }

  function checkWork() {
    addLine("system", `Check my work: ${checkWorkTarget}`);
    mockTutorReply("[Mocked reply: feedback on the student's work appears here.]");
  }

  const tutorOptions = state.tutors.map((item) => ({ value: item.id, label: item.name || "Unnamed tutor" }));

  return (
    <section aria-label="Conversation" className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">Conversation</h2>
        <MockBadge />
      </div>

      <FieldSelect
        id="conversation-tutor"
        label="Tutor"
        value={tutor.id}
        options={tutorOptions}
        placeholder="Choose a tutor"
        onChange={switchTutor}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant={status === "idle" ? "default" : "outline"} onClick={toggleSession}>
          {status === "idle" ? "Start session" : "End session"}
        </Button>
        {voiceOn && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={muted ? "Unmute microphone" : "Mute microphone"}
            aria-pressed={muted}
            onClick={() => setMuted((current) => !current)}
          >
            {muted ? <MicOff /> : <Mic />}
          </Button>
        )}
        <div className="flex items-center gap-2">
          <Switch id="conversation-voice" checked={voiceOn} onCheckedChange={setVoiceOn} />
          <Label htmlFor="conversation-voice">Voice</Label>
        </div>
      </div>

      <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
        <span
          aria-hidden="true"
          className="size-2.5 rounded-full"
          style={{ backgroundColor: status === "idle" ? "#a3a3a3" : COLOR_HEX[tutor.color] }}
        />
        {STATUS_LABEL[status]}
        {status !== "idle" && !voiceOn && " (text only)"}
        {status !== "idle" && voiceOn && muted && " (muted)"}
      </p>

      <div
        ref={transcript}
        className="min-h-40 flex-1 space-y-2 overflow-y-auto rounded-md border p-3 text-sm"
        aria-label="Transcript"
        tabIndex={0}
      >
        {lines.length === 0 && (
          <p className="text-muted-foreground">Nothing yet. Start a session or type a message below.</p>
        )}
        {lines.map((line) =>
          line.who === "system" ? (
            <p key={line.id} className="text-xs text-muted-foreground">
              {line.text}
            </p>
          ) : (
            <p key={line.id}>
              <span className="font-medium">{line.who === "student" ? "You" : tutor.name || "Tutor"}: </span>
              {line.text}
            </p>
          ),
        )}
      </div>

      {checkWorkTarget && (
        <Button type="button" variant="outline" onClick={checkWork}>
          Check my work: {checkWorkTarget}
        </Button>
      )}

      <form onSubmit={send} className="flex gap-2">
        <Input
          aria-label="Message your tutor"
          placeholder="Type a message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" size="icon" aria-label="Send message">
          <Send />
        </Button>
      </form>

      {footer}
    </section>
  );
}
