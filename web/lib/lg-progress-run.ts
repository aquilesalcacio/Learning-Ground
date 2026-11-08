"use client";

// get_student_progress: what the student is working on and finding hard, for the tutor to pick a
// practice problem from. The voice tool and the debug panel both call runStudentProgress.
// Canvas LMS gives us no grades, so the weak spots come from Learning Grounds' own checks.
import { doneLookingAtLgWork, lookAtLgBoard } from "./lg-actions";
import { feedLines, fetchCanvasLmsProfile, refreshCanvasLmsCalendarFeed } from "./lg-canvas-lms";
import { profileLines, recentPractice, savedSource, wrongChecks } from "./lg-progress";
import { getActiveConversation, readLgState } from "./lg-store";
import { type LgProgressData, progressReport } from "./lg-tutor-prompt";

// The tool gives up on fresh Canvas LMS data after this, and uses the saved profile instead.
const FRESH_MS = 4000;

type Fresh = Pick<LgProgressData, "source" | "courses" | "upcoming">;

// The calendar feed first: a 409 just means none is saved, so no status call is needed. Then the
// OAuth import, which answers 409 when the student never connected. Both update the profile too.
// The report is built from what they return, because the profile keeps old lines when the feed
// has none. Past the deadline nobody reads the result, so the import isn't started.
async function freshCanvasLms(until: number): Promise<Fresh | null> {
  const feed = await refreshCanvasLmsCalendarFeed();
  if (feed.ok) return { source: "calendar_feed", ...feedLines(feed.value) };
  if (Date.now() >= until) return null;
  const imported = await fetchCanvasLmsProfile();
  if (imported.ok) {
    return { source: "canvas_lms", courses: profileLines(imported.value.courses), upcoming: profileLines(imported.value.upcoming) };
  }
  return null;
}

// Null once ms have passed. A request still running then finishes in the background.
async function within<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([work, late]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function gatherStudentProgress(): Promise<LgProgressData> {
  const fresh = await within(freshCanvasLms(Date.now() + FRESH_MS), FRESH_MS);
  // Read after the refresh, so the courses it merged into the profile are here.
  const state = readLgState();
  const { profile } = state;
  const saved = { courses: profileLines(profile.courses), upcoming: profileLines(profile.upcoming) };
  const active = getActiveConversation(state);
  const assignment = active?.canvas_lms_assignment;
  return {
    source: fresh?.source ?? savedSource(saved),
    today: new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
    courses: [...new Set([...(fresh?.courses ?? []), ...saved.courses])],
    upcoming: fresh ? fresh.upcoming : saved.upcoming,
    finds_hard: profile.struggles,
    assignment: assignment ? { title: assignment.title, course: assignment.course, due_label: assignment.due_label } : null,
    wrong_checks: wrongChecks(state.conversations),
    recent_practice: recentPractice(state.conversations, active?.id),
  };
}

// The pen thinks in the middle of the view while this runs, and always stops, because its open
// step holds up every mark queued after it.
export async function runStudentProgress(): Promise<string> {
  lookAtLgBoard();
  try {
    return progressReport(await gatherStudentProgress());
  } catch (error) {
    console.error("[lg] get_student_progress failed", error);
    return "The student's progress couldn't be looked up. Write a short warm-up problem instead, and don't ask them what they want.";
  } finally {
    doneLookingAtLgWork(false);
  }
}
