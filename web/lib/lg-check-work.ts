"use client";

import { LgApiAuthError, lgApiFetch } from "./lg-api";
import { captureLgRegion } from "./lg-board-link";
import { apiErrorMessage } from "./lg-document";
import { findRegion } from "./lg-regions";
import { getActiveDocument, getActiveTutor, readLgState, recordWorkCheck } from "./lg-store";

export type WorkCheck = {
  status: "correct" | "incomplete" | "error" | "blank" | "unreadable";
  student_wrote: string;
  analysis: string;
  hint: string;
};

export type WorkCheckOutcome =
  | { ok: true; region_id: string; label: string; check: WorkCheck }
  | { ok: false; message: string };

// One path for the button and the voice tool: snapshot the region, then ask the API about it.
// With no homework open, the whole board is checked, whatever region_id says.
export async function checkStudentWork(region_id: string): Promise<WorkCheckOutcome> {
  const document = getActiveDocument(readLgState());
  const region = findRegion(document, region_id);
  if (document && !region) return { ok: false, message: `There's no region called ${region_id}.` };
  const label = region?.label ?? "the board";
  const checked_id = region?.region_id ?? "";

  const capture = await captureLgRegion(region_id);
  if (capture === "no_board") return { ok: false, message: "No board is open, so there's no work to check." };
  if (capture === "unknown_region") return { ok: false, message: `There's no region called ${region_id}.` };
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
    recordWorkCheck({ label, status: check.status });
    return { ok: true, region_id: checked_id, label, check };
  } catch (error) {
    if (error instanceof LgApiAuthError) return { ok: false, message: error.message };
    return { ok: false, message: "Check my work can't reach the API. Is it running on port 8000?" };
  }
}

// The report the tutor receives. It answers the student in its own words.
export function workReport({ region_id, label, check }: Extract<WorkCheckOutcome, { ok: true }>) {
  return [
    region_id
      ? `Student work on ${label} (${region_id}). Status: ${check.status}.`
      : `Student work on the board (no homework is open). Status: ${check.status}.`,
    `They wrote: ${check.student_wrote}`,
    `Analysis: ${check.analysis}`,
    `Suggested hint: ${check.hint}`,
  ].join("\n");
}
