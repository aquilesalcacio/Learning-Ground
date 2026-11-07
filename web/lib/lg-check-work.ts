"use client";

import { captureLgRegion } from "./lg-board-link";
import { findRegion } from "./lg-regions";
import { getActiveTutor, readLgState } from "./lg-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type WorkCheck = {
  status: "correct" | "incomplete" | "error" | "blank" | "unreadable";
  student_wrote: string;
  analysis: string;
  hint: string;
};

export type WorkCheckOutcome =
  | { ok: true; region_id: string; label: string; check: WorkCheck }
  | { ok: false; message: string };

async function errorMessage(response: Response) {
  const body = await response.json().catch(() => null);
  return typeof body?.detail === "string" ? body.detail : "Check my work failed. Please try again.";
}

// One path for the button and the voice tool: snapshot the region, then ask the API about it.
export async function checkStudentWork(region_id: string): Promise<WorkCheckOutcome> {
  const region = findRegion(region_id);
  if (!region) return { ok: false, message: `There's no region called ${region_id}.` };

  const capture = await captureLgRegion(region_id);
  if (capture === "no_board") return { ok: false, message: "No board is open, so there's no work to check." };
  if (capture === "unknown_region") return { ok: false, message: `There's no region called ${region_id}.` };
  if (capture === "no_work") return { ok: false, message: `Nothing is written on ${region.label} yet.` };

  const form = new FormData();
  form.append("image", capture, "work.png");
  form.append("label", region.label);
  const language = getActiveTutor(readLgState()).language;
  if (language) form.append("language", language);

  try {
    const response = await fetch(`${API_URL}/check-work`, { method: "POST", body: form });
    if (!response.ok) return { ok: false, message: await errorMessage(response) };
    return { ok: true, region_id, label: region.label, check: (await response.json()) as WorkCheck };
  } catch {
    return { ok: false, message: "Check my work can't reach the API. Is it running on port 8000?" };
  }
}

// The report the tutor receives. It answers the student in its own words.
export function workReport({ region_id, label, check }: Extract<WorkCheckOutcome, { ok: true }>) {
  return [
    `Student work on ${label} (${region_id}). Status: ${check.status}.`,
    `They wrote: ${check.student_wrote}`,
    `Analysis: ${check.analysis}`,
    `Suggested hint: ${check.hint}`,
  ].join("\n");
}
