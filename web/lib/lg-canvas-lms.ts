"use client";

// The Student Profile's Canvas LMS connections. Three routes, all run by FastAPI:
// - LTI 1.1: the student opens Learning Grounds from their Canvas LMS course (api/canvas_lms_lti.py).
// - Calendar feed: the student pastes their Canvas LMS calendar feed link (api/canvas_lms_feed.py).
// - OAuth2: needs a school's Developer Key, so it only shows when the server has one (api/canvas_lms.py).
import { LgApiAuthError, lgApiFetch } from "./lg-api";
import { apiErrorMessage } from "./lg-document";
import { readLgState, updateProfile } from "./lg-store";
import type { LgLanguage, StudentProfile } from "./lg-types";

export type CanvasLmsStatus = {
  connected: boolean;
  canvas_lms_user: string;
  oauth_available: boolean;
  lti_ready: boolean;
  calendar_feed: boolean;
};

type CanvasLmsProfile = Pick<StudentProfile, "name" | "school" | "courses" | "upcoming"> & {
  language: LgLanguage | "";
};

export type CanvasLmsLaunch = {
  name: string;
  email: string;
  language: LgLanguage | "";
  school: string;
  course: string;
  course_code: string;
  sections: string[];
  roles: string[];
  assignment_title: string;
  upcoming_line: string;
};

export type CalendarFeedImport = { courses: string[]; upcoming: string; event_count: number };

export type CanvasLmsResult<T> = { ok: true; value: T } | { ok: false; message: string };

const UNREACHABLE = "Can't reach the API. Is it running on port 8000?";

async function call<T>(path: string, init: RequestInit, fallback: string): Promise<CanvasLmsResult<T>> {
  try {
    const response = await lgApiFetch(path, init);
    if (!response.ok) return { ok: false, message: await apiErrorMessage(response, fallback) };
    return { ok: true, value: (await response.json()) as T };
  } catch (error) {
    return { ok: false, message: error instanceof LgApiAuthError ? error.message : UNREACHABLE };
  }
}

function postJson(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

// Adds lines that aren't there yet, keeping the student's own lines and their order.
function mergeLines(existing: string, additions: string[]): string {
  const lines = existing.split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of additions.map((l) => l.trim()).filter(Boolean)) {
    if (!lines.includes(line)) lines.push(line);
  }
  return lines.join("\n");
}

export function canvasLmsStatus() {
  return call<CanvasLmsStatus>("/canvas-lms/status", {}, "Couldn't check the Canvas LMS connection.");
}

// --- LTI: opened from a Canvas LMS course -------------------------------------------------------

// Collects what Canvas LMS sent when the student opened Learning Grounds, and fills the profile.
// Canvas LMS is the source of truth for name and course; the student's own notes stay.
export async function claimCanvasLmsLaunch(code: string): Promise<CanvasLmsResult<CanvasLmsLaunch>> {
  const result = await call<CanvasLmsLaunch>(
    "/canvas-lms/launch/claim",
    postJson({ code }),
    "Couldn't read what Canvas LMS sent. Open Learning Grounds from Canvas LMS again.",
  );
  if (!result.ok) return result;
  const launch = result.value;
  const current = readLgState().profile;
  updateProfile({
    name: launch.name || current.name,
    school: current.school || launch.school,
    courses: mergeLines(current.courses, [launch.course]),
    upcoming: mergeLines(current.upcoming, [launch.upcoming_line]),
    language: current.language || launch.language,
  });
  return result;
}

// --- Calendar feed -----------------------------------------------------------------------------

function applyFeed(feed: CalendarFeedImport) {
  const current = readLgState().profile;
  // The feed lists every due date across courses, so it replaces Coming up rather than adding to it.
  updateProfile({ courses: mergeLines(current.courses, feed.courses), upcoming: feed.upcoming || current.upcoming });
}

export async function addCanvasLmsCalendarFeed(url: string): Promise<CanvasLmsResult<CalendarFeedImport>> {
  const result = await call<CalendarFeedImport>("/canvas-lms/calendar-feed", postJson({ url }), "Couldn't read that calendar feed.");
  if (result.ok) applyFeed(result.value);
  return result;
}

export async function refreshCanvasLmsCalendarFeed(): Promise<CanvasLmsResult<CalendarFeedImport>> {
  const result = await call<CalendarFeedImport>("/canvas-lms/calendar-feed", {}, "Couldn't refresh the calendar feed.");
  if (result.ok) applyFeed(result.value);
  return result;
}

export function removeCanvasLmsCalendarFeed() {
  return call<{ calendar_feed: boolean }>("/canvas-lms/calendar-feed/remove", { method: "POST" }, "Couldn't remove the calendar feed.");
}

// --- OAuth2 (needs a school's Developer Key) ---------------------------------------------------

// Sends the browser to Canvas LMS. It comes back to /profile?canvas_lms=connected (or denied, or error).
export async function connectCanvasLms(): Promise<CanvasLmsResult<never> | undefined> {
  const result = await call<{ url: string }>("/canvas-lms/connect", { method: "POST" }, "Couldn't start Canvas LMS.");
  if (!result.ok) return result;
  window.location.assign(result.value.url);
}

// Fills the profile from Canvas LMS. The student's own "what's hard" notes are never touched,
// and a blank value from Canvas LMS never wipes something the student typed.
export async function importCanvasLmsProfile(): Promise<CanvasLmsResult<CanvasLmsProfile>> {
  const result = await call<CanvasLmsProfile>("/canvas-lms/profile", {}, "Couldn't import from Canvas LMS.");
  if (!result.ok) return result;
  const imported = result.value;
  const current = readLgState().profile;
  updateProfile({
    name: imported.name || current.name,
    school: imported.school || current.school,
    courses: imported.courses || current.courses,
    upcoming: imported.upcoming,
    language: current.language || imported.language,
  });
  return result;
}

export function disconnectCanvasLms() {
  return call<CanvasLmsStatus>("/canvas-lms/disconnect", { method: "POST" }, "Couldn't disconnect Canvas LMS.");
}
