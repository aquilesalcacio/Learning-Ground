"use client";

import { LgApiAuthError, lgApiFetch } from "./lg-api";
import { captureLgRegion } from "./lg-board-link";
import { apiErrorMessage } from "./lg-document";
import { markVerdictFor } from "./lg-ink";
import { findRegion } from "./lg-regions";
import { selectionLabel } from "./lg-selection";
import { findBoardQuestion, findBoardSelection, getActiveDocument, getActiveTutor, readLgState, recordWorkCheck } from "./lg-store";

export type WorkCheck = {
  status: "correct" | "incomplete" | "error" | "blank" | "unreadable";
  student_wrote: string;
  analysis: string;
  hint: string;
};

export type WorkCheckOutcome =
  | { ok: true; region_id: string; label: string; check: WorkCheck }
  | { ok: false; message: string };

// A question the tutor wrote on the board is checked by its own text, within the API's 80 characters.
const LABEL_MAX = 80;
// What the problem says, kept with the check so get_student_progress can name the weak spot.
const TOPIC_MAX = 120;

function questionLabel(id: string, text: string) {
  const label = `Question ${id.replace(/^q/, "")}: ${text}`;
  return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1).trimEnd()}…` : label;
}

// One path for the button and the voice tool: snapshot the region, then ask the API about it.
// A written question (q1) is checked by its answer box, and a spot the student circled (s1) by
// what's inside its loop. With no homework open and no such question or spot, the whole board is
// checked, whatever region_id says.
export async function checkStudentWork(region_id: string): Promise<WorkCheckOutcome> {
  const state = readLgState();
  const document = getActiveDocument(state);
  const selection = findBoardSelection(state, region_id);
  // A circled spot is named after the problem or question it's on, which is also its topic.
  const question = findBoardQuestion(state, selection ? (selection.question_id ?? "") : region_id);
  const region = findRegion(document, selection ? (selection.region_id ?? "") : region_id);
  if (document && !region && !question && !selection) return { ok: false, message: `There's no region called ${region_id}.` };
  const owner = question ? questionLabel(question.id, question.text) : region?.label;
  const label = selection ? selectionLabel(owner ?? "") : (owner ?? "the board");
  const checked_id = selection?.id ?? question?.id ?? region?.region_id ?? "";

  const capture = await captureLgRegion(region_id);
  if (capture === "no_board") return { ok: false, message: "No board is open, so there's no work to check." };
  if (capture === "unknown_region") return { ok: false, message: `There's no region called ${region_id}.` };
  if (capture === "no_work" && selection) {
    const printed = question
      ? " It's part of your question: explain it with a mark."
      : region
        ? " It's part of the problem itself: explain it with a mark."
        : "";
    return { ok: false, message: `The student hasn't written anything in ${label}.${printed}` };
  }
  if (capture === "no_work") return { ok: false, message: `Nothing is written on ${label} yet.` };

  const form = new FormData();
  form.append("image", capture, "work.png");
  form.append("label", label);
  const language = getActiveTutor(readLgState()).language;
  if (language) form.append("language", language);

  try {
    const response = await lgApiFetch("/check-work", { method: "POST", body: form });
    if (!response.ok) return { ok: false, message: await apiErrorMessage(response, "Check my work failed. Please try again.") };
    const check = (await response.json()) as WorkCheck;
    const topic = (question?.text ?? region?.text ?? "").replace(/\s+/g, " ").trim().slice(0, TOPIC_MAX);
    recordWorkCheck({ label, status: check.status, ...(topic ? { topic } : {}), at: Date.now() });
    return { ok: true, region_id: checked_id, label, check };
  } catch (error) {
    if (error instanceof LgApiAuthError) return { ok: false, message: error.message };
    return { ok: false, message: "Check my work can't reach the API. Is it running on port 8000?" };
  }
}

// The report the tutor receives. It answers the student in its own words.
export function workReport({ region_id, label, check }: Extract<WorkCheckOutcome, { ok: true }>) {
  const verdict = markVerdictFor(check.status);
  return [
    region_id
      ? `Student work on ${label} (${region_id}). Status: ${check.status}.`
      : `Student work on the board (no homework is open). Status: ${check.status}.`,
    `They wrote: ${check.student_wrote}`,
    `Analysis: ${check.analysis}`,
    `Suggested hint: ${check.hint}`,
    ...(region_id && verdict ? [`Mark it: mark_work on ${region_id} with verdict ${verdict}.`] : []),
  ].join("\n");
}
