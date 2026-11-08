"use client";

import { CheckCircle2, ChevronDown, ChevronUp, Send } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { previewTurnIn, sessionSummary, turnInToCanvasLms } from "@/lib/lg-canvas-lms";
import type { Conversation } from "@/lib/lg-types";

function attemptsLabel(used: string, allowed: string) {
  if (allowed && allowed !== "-1") return `attempt ${Number(used || 0) + 1} of ${allowed}`;
  return used ? `${used} ${used === "1" ? "attempt" : "attempts"} so far` : "";
}

// Shown at the top of a chat opened from a Canvas LMS assignment: what it is, its instructions,
// and Turn in, which sends a summary of this session back to Canvas LMS after the student confirms.
export function CanvasLmsAssignmentBar({ conversation, tutorName }: { conversation: Conversation; tutorName: string }) {
  const assignment = conversation.canvas_lms_assignment;
  const [showInstructions, setShowInstructions] = useState(false);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!assignment) return null;

  const facts = [
    assignment.course,
    assignment.due_label && `due ${assignment.due_label}`,
    assignment.points && `${assignment.points} pts`,
    attemptsLabel(assignment.attempts_used, assignment.attempts_allowed),
  ].filter(Boolean);

  async function loadPreview(currentNote: string) {
    const result = await previewTurnIn(sessionSummary(conversation, tutorName, currentNote));
    if (result.ok) setPreview(result.value.html);
    else setMessage(result.message);
  }

  function openTurnIn() {
    setMessage("");
    setPreview("");
    setOpen(true);
    void loadPreview(note);
  }

  async function confirmTurnIn() {
    setBusy(true);
    const result = await turnInToCanvasLms(conversation.id, sessionSummary(conversation, tutorName, note));
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      setMessage("Turned in to Canvas LMS. Your teacher sees it in SpeedGrader.");
    } else {
      setMessage(result.message);
    }
  }

  return (
    <div className="pointer-events-auto w-full max-w-2xl rounded-xl bg-background/90 p-3 text-sm shadow-sm ring-1 ring-foreground/10 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            Working on, from Canvas LMS{assignment.link_title && assignment.link_title !== assignment.title ? ` · ${assignment.link_title}` : ""}
          </p>
          <p className="truncate font-medium">{assignment.title}</p>
          {facts.length > 0 && <p className="truncate text-xs text-muted-foreground">{facts.join(" · ")}</p>}
        </div>
        {assignment.instructions && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={showInstructions}
            onClick={() => setShowInstructions((value) => !value)}
          >
            Instructions {showInstructions ? <ChevronUp /> : <ChevronDown />}
          </Button>
        )}
        {assignment.turned_in_at ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <CheckCircle2 className="size-4" aria-hidden="true" /> Turned in
          </span>
        ) : assignment.turn_in_id ? (
          <Button type="button" size="sm" onClick={openTurnIn}>
            <Send /> Turn in to Canvas
          </Button>
        ) : null}
      </div>

      {showInstructions && (
        <p className="mt-2 max-h-40 overflow-y-auto border-t pt-2 whitespace-pre-line text-muted-foreground">
          {assignment.instructions}
        </p>
      )}
      {message && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {message}
        </p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <div className="grid gap-1">
            <DialogTitle>Turn in to Canvas LMS</DialogTitle>
            <DialogDescription>
              This is what your teacher will see for &ldquo;{assignment.title}&rdquo;. It&apos;s marked as made with
              Learning Grounds and earns completion points. Your teacher&apos;s own grade replaces it.
            </DialogDescription>
          </div>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Note for your teacher (optional)</span>
            <Textarea
              rows={2}
              maxLength={600}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onBlur={() => void loadPreview(note)}
              placeholder="What you worked on, or where you got stuck"
            />
          </label>
          <div className="max-h-64 overflow-y-auto rounded-lg border bg-muted/40 p-3 text-sm [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-2">
            {preview ? (
              // Built and HTML-escaped by our API (canvas_lms_grades.summary_html), the same text Canvas LMS receives.
              <div dangerouslySetInnerHTML={{ __html: preview }} />
            ) : (
              <p className="text-muted-foreground">Preparing the preview…</p>
            )}
          </div>
          {message && open && (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="button" onClick={confirmTurnIn} disabled={busy || !preview}>
              {busy ? "Turning in…" : "Turn in"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
