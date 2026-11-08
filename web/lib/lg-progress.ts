// The parts of get_student_progress that only shape saved data, so `node --test` can run them.
// lg-progress-run.ts does the fetching. Type-only imports keep this file free of runtime code;
// progressReport in lg-tutor-prompt.ts caps every list, so nothing here slices.
import type { LgProgressData, LgProgressSource } from "./lg-tutor-prompt";
import type { Conversation } from "./lg-types";

// A profile field's lines, trimmed, blank ones left out.
export const profileLines = (text: string | undefined): string[] =>
  (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

// Checks across every chat that found a mistake or an unfinished answer, newest first. Checks
// saved before `at` existed count as made when their chat started. Blank and unreadable checks
// say nothing about the math, so they're left out.
export function wrongChecks(conversations: Conversation[]): LgProgressData["wrong_checks"] {
  return conversations
    .flatMap((conversation) =>
      (conversation.work_checks ?? []).map((check) => ({ check, at: check.at ?? conversation.created_at })),
    )
    .filter(({ check }) => check.status === "error" || check.status === "incomplete")
    .sort((a, b) => b.at - a.at)
    .map(({ check }) => ({ label: check.label, status: check.status, topic: check.topic }));
}

// Practice questions the tutor wrote, newest first, each once. Chats have no "last used" time,
// so the open chat's questions come first (they're the ones just written), then the other chats
// from newest to oldest.
export function recentPractice(conversations: Conversation[], activeId?: string | null): string[] {
  const ordered = [...conversations].sort(
    (a, b) => Number(b.id === activeId) - Number(a.id === activeId) || b.created_at - a.created_at,
  );
  const texts = ordered.flatMap((conversation) => [...(conversation.practice_history ?? [])].reverse());
  return [...new Set(texts)];
}

// Where the report's courses and upcoming work came from, when no fresh Canvas LMS data arrived.
export function savedSource(saved: { courses: string[]; upcoming: string[] }): LgProgressSource {
  return saved.courses.length || saved.upcoming.length ? "profile" : "none";
}
