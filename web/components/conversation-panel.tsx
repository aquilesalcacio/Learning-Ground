"use client";

import { Mic, MicOff, Send } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { FieldSelect } from "@/components/lg-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useLgFocusRegion } from "@/lib/lg-board-link";
import { findRegion } from "@/lib/lg-regions";
import { getActiveTutor, setActiveTutor, useLgState } from "@/lib/lg-store";
import { COLOR_HEX } from "@/lib/lg-types";
import { LgVoiceProvider, type LgVoiceStatus, useLgVoice } from "@/lib/lg-voice";

const STATUS_LABEL: Record<LgVoiceStatus, string> = {
  idle: "Not connected",
  connecting: "Connecting",
  listening: "Listening",
  speaking: "Tutor speaking",
};

// checkWorkTarget turns on the Check my work button. The button follows the region in use on the board.
type ConversationPanelProps = { checkWorkTarget?: string; footer?: ReactNode };

// One conversation component for Learning Grounds and Chat (vision doc, section 8.2).
function ConversationDock({ checkWorkTarget, footer }: ConversationPanelProps) {
  const state = useLgState();
  const tutor = getActiveTutor(state);
  const voice = useLgVoice();
  const [voiceOn, setVoiceOn] = useState(true);
  const [draft, setDraft] = useState("");
  const focusRegionId = useLgFocusRegion();
  const focusLabel = findRegion(focusRegionId)?.label;
  const transcript = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = transcript.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [voice.lines]);

  function switchTutor(id: string) {
    const next = state.tutors.find((item) => item.id === id);
    if (!next) return;
    setActiveTutor(id);
    voice.switchTutor(next, !voiceOn);
  }

  function send(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || !voice.connected) return;
    // The SDK only reports spoken student turns, so typed ones are added here.
    voice.addLine("student", message);
    voice.sendText(message);
    setDraft("");
  }

  const tutorOptions = state.tutors.map((item) => ({ value: item.id, label: item.name || "Unnamed tutor" }));
  const active = voice.status !== "idle";

  return (
    <section aria-label="Conversation" className="flex min-h-0 flex-1 flex-col gap-3">
      <h2 className="font-medium">Conversation</h2>

      <FieldSelect
        id="conversation-tutor"
        label="Tutor"
        value={tutor.id}
        options={tutorOptions}
        placeholder="Choose a tutor"
        onChange={switchTutor}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={active ? "outline" : "default"}
          disabled={voice.status === "connecting"}
          onClick={() => (active ? voice.end() : voice.start(tutor, !voiceOn))}
        >
          {active ? "End session" : "Start session"}
        </Button>
        {voiceOn && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={voice.muted ? "Unmute microphone" : "Mute microphone"}
            aria-pressed={voice.muted}
            onClick={() => voice.setMuted(!voice.muted)}
          >
            {voice.muted ? <MicOff /> : <Mic />}
          </Button>
        )}
        <div className="flex items-center gap-2">
          <Switch id="conversation-voice" checked={voiceOn} disabled={active} onCheckedChange={setVoiceOn} />
          <Label htmlFor="conversation-voice">Voice</Label>
        </div>
      </div>

      <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
        <span
          aria-hidden="true"
          className="size-2.5 rounded-full"
          style={{ backgroundColor: active ? COLOR_HEX[tutor.color] : "#a3a3a3" }}
        />
        {STATUS_LABEL[voice.status]}
        {active && !voiceOn && " (text only)"}
        {active && voiceOn && voice.muted && " (muted)"}
      </p>

      {voice.error && (
        <p role="alert" className="text-sm text-destructive">
          {voice.error}
        </p>
      )}

      <div
        ref={transcript}
        className="min-h-40 flex-1 space-y-2 overflow-y-auto rounded-md border p-3 text-sm"
        aria-label="Transcript"
        tabIndex={0}
      >
        {voice.lines.length === 0 && (
          <p className="text-muted-foreground">Nothing yet. Start a session, then talk or type.</p>
        )}
        {voice.lines.map((line) =>
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
        <Button type="button" variant="outline" disabled={voice.checking} onClick={() => voice.checkWork(focusRegionId)}>
          {voice.checking ? `Checking ${focusLabel}...` : `Check my work: ${focusLabel}`}
        </Button>
      )}

      <form onSubmit={send} className="flex gap-2">
        <Input
          aria-label="Message your tutor"
          placeholder={voice.connected ? "Type a message" : "Start a session to type"}
          disabled={!voice.connected}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" size="icon" aria-label="Send message" disabled={!voice.connected}>
          <Send />
        </Button>
      </form>

      {footer}
    </section>
  );
}

export function ConversationPanel(props: ConversationPanelProps) {
  return (
    <LgVoiceProvider>
      <ConversationDock {...props} />
    </LgVoiceProvider>
  );
}
