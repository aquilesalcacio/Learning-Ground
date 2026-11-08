"use client";

// The Student Profile's Canvas LMS connections. Three routes, all run by FastAPI:
// - LTI 1.1: the student opens Learning Grounds from their Canvas LMS course (api/canvas_lms_lti.py).
// - Calendar feed: the student pastes their Canvas LMS calendar feed link (api/canvas_lms_feed.py).
// - OAuth2: needs a school's Developer Key, so it only shows when the server has one (api/canvas_lms.py).
import { LgApiAuthError, lgApiFetch } from "./lg-api";
import { apiErrorMessage } from "./lg-document";
import { profileLines } from "./lg-progress";
import {
  markCanvasLmsTurnedIn,
  readLgState,
  setCanvasLmsInfo,
  startCanvasLmsAssignmentChat,
  updateProfile,
} from "./lg-store";
import type { CanvasLmsCourse, Conversation, LgLanguage, StudentProfile, WorkCheckRecord } from "./lg-types";

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
  assignment_due_at: string;
  assignment_points: string;
  upcoming_line: string;
  photo_url: string;
  enrollment_state: string;
  course_start_at: string;
  course_end_at: string;
  link_title: string;
  assignment_instructions: string;
  assignment_due_label: string;
  assignment_attempts_used: string;
  assignment_attempts_allowed: string;
  turn_in_id: string;
};

type CalendarFeedItem = { course_code: string; title: string; due: string };
export type CalendarFeedImport = { courses: string[]; upcoming: string; event_count: number; items: CalendarFeedItem[] };

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
  const lines = profileLines(existing);
  for (const line of additions.map((l) => l.trim()).filter(Boolean)) {
    if (!lines.includes(line)) lines.push(line);
  }
  return lines.join("\n");
}

export function canvasLmsStatus() {
  return call<CanvasLmsStatus>("/canvas-lms/status", {}, "Couldn't check the Canvas LMS connection.");
}

// --- LTI: opened from a Canvas LMS course -------------------------------------------------------

function rememberCourse(courses: CanvasLmsCourse[], launch: CanvasLmsLaunch): CanvasLmsCourse[] {
  if (!launch.course) return courses;
  const course: CanvasLmsCourse = {
    name: launch.course,
    code: launch.course_code,
    sections: launch.sections,
    start_at: launch.course_start_at,
    end_at: launch.course_end_at,
  };
  return [course, ...courses.filter((item) => item.name !== course.name)].slice(0, 12);
}

// Collects what Canvas LMS sent when the student opened Learning Grounds, and fills the profile.
// Canvas LMS is the source of truth for name and course; the student's own notes stay. A launch
// from an assignment opens a new chat about it. Returns where to go next.
export async function claimCanvasLmsLaunch(code: string): Promise<CanvasLmsResult<{ launch: CanvasLmsLaunch; to: string }>> {
  const result = await call<CanvasLmsLaunch>(
    "/canvas-lms/launch/claim",
    postJson({ code }),
    "Couldn't read what Canvas LMS sent. Open Learning Grounds from Canvas LMS again.",
  );
  if (!result.ok) return result;
  const launch = result.value;
  const state = readLgState();
  const current = state.profile;
  updateProfile({
    name: launch.name || current.name,
    school: current.school || launch.school,
    courses: mergeLines(current.courses, [launch.course]),
    upcoming: mergeLines(current.upcoming, [launch.upcoming_line]),
    language: current.language || launch.language,
  });
  setCanvasLmsInfo({
    name: launch.name,
    photo_url: launch.photo_url,
    roles: launch.roles,
    enrollment_state: launch.enrollment_state,
    school: launch.school,
    courses: rememberCourse(state.canvas_lms?.courses ?? [], launch),
    linked_at: Date.now(),
  });
  if (!launch.assignment_title) return { ok: true, value: { launch, to: "/profile" } };
  startCanvasLmsAssignmentChat({
    title: launch.assignment_title,
    course: launch.course,
    course_code: launch.course_code,
    link_title: launch.link_title,
    due_at: launch.assignment_due_at,
    due_label: launch.assignment_due_label,
    points: launch.assignment_points,
    attempts_used: launch.assignment_attempts_used,
    attempts_allowed: launch.assignment_attempts_allowed,
    instructions: launch.assignment_instructions,
    turn_in_id: launch.turn_in_id,
    turned_in_at: "",
  });
  return { ok: true, value: { launch, to: "/" } };
}

// --- Calendar feed -----------------------------------------------------------------------------

// The feed's courses and "Course: assignment (due ...)" lines, soonest first, as the profile shows
// them. get_student_progress reads these too, because applyFeed keeps the old lines when the feed has none.
export function feedLines(feed: CalendarFeedImport): { courses: string[]; upcoming: string[] } {
  // Canvas LMS tags feed events with course codes ("SB-101"). Launches taught us the names behind them.
  const names = new Map((readLgState().canvas_lms?.courses ?? []).filter((c) => c.code).map((c) => [c.code, c.name]));
  const named = (code: string) => names.get(code) ?? code;
  return {
    courses: feed.courses.map(named),
    upcoming: feed.items.map((item) => `${item.course_code ? `${named(item.course_code)}: ` : ""}${item.title} (due ${item.due})`),
  };
}

function applyFeed(feed: CalendarFeedImport) {
  const state = readLgState();
  const { courses, upcoming } = feedLines(feed);
  // The feed lists every due date across courses, so it replaces Coming up rather than adding to it.
  updateProfile({
    courses: mergeLines(state.profile.courses, courses),
    upcoming: upcoming.join("\n") || state.profile.upcoming,
  });
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

// The same import for get_student_progress, which runs without the student pressing Import, so
// it only adds courses and refreshes Coming up (when Canvas LMS lists something), as the feed does.
// Name, school and language stay as the student left them.
export async function fetchCanvasLmsProfile(): Promise<CanvasLmsResult<CanvasLmsProfile>> {
  const result = await call<CanvasLmsProfile>("/canvas-lms/profile", {}, "Couldn't import from Canvas LMS.");
  if (!result.ok) return result;
  const imported = result.value;
  const current = readLgState().profile;
  updateProfile({
    courses: mergeLines(current.courses, profileLines(imported.courses)),
    upcoming: (imported.upcoming ?? "").trim() || current.upcoming,
  });
  return result;
}

export function disconnectCanvasLms() {
  return call<CanvasLmsStatus>("/canvas-lms/disconnect", { method: "POST" }, "Couldn't disconnect Canvas LMS.");
}

// --- Turn in to Canvas LMS ----------------------------------------------------------------------

export type TurnInSummary = {
  turn_in_id: string;
  tutor_name: string;
  started_at: number;
  minutes: number;
  student_messages: number;
  tutor_messages: number;
  checks: Pick<WorkCheckRecord, "label" | "status">[];
  note: string;
};

// What the chat knows about the session. The server writes the text and decides the score.
export function sessionSummary(conversation: Conversation, tutor_name: string, note: string): TurnInSummary {
  const count = (who: string) => conversation.messages.filter((message) => message.who === who).length;
  return {
    turn_in_id: conversation.canvas_lms_assignment?.turn_in_id ?? "",
    tutor_name: tutor_name.slice(0, 60),
    started_at: conversation.created_at,
    minutes: Math.min(Math.round((Date.now() - conversation.created_at) / 60_000), 24 * 60),
    student_messages: count("student"),
    tutor_messages: count("tutor"),
    // Only what the teacher's summary uses: a check's topic and time stay in the browser.
    checks: (conversation.work_checks ?? []).slice(-30).map(({ label, status }) => ({ label: label.slice(0, 80), status })),
    note: note.slice(0, 600),
  };
}

export function previewTurnIn(summary: TurnInSummary) {
  return call<{ html: string; score: string }>("/canvas-lms/turn-in/preview", postJson(summary), "Couldn't prepare the turn-in.");
}

export async function turnInToCanvasLms(conversation_id: string, summary: TurnInSummary) {
  const result = await call<{ turned_in_at: string; score: string }>(
    "/canvas-lms/turn-in",
    postJson(summary),
    "Couldn't turn this in to Canvas LMS.",
  );
  if (result.ok) markCanvasLmsTurnedIn(conversation_id, result.value.turned_in_at);
  return result;
}
