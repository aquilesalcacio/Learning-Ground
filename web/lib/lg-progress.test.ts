// Run from web/: node --test lib/lg-progress.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Conversation, WorkCheckRecord } from "./lg-types";

// Node needs the extension and TypeScript rejects it in a static import, so it's loaded here.
const progress = (await import(`./lg-progress${".ts"}`)) as typeof import("./lg-progress");
const { profileLines, recentPractice, savedSource, wrongChecks } = progress;

function chat(id: string, created_at: number, extra: Partial<Conversation> = {}): Conversation {
  return { id, tutor_id: "sam", title: id, created_at, messages: [], document: null, ...extra };
}

test("profile lines are trimmed and blank ones left out", () => {
  assert.deepEqual(profileLines("  Algebra I \n\n Biology 101\n  "), ["Algebra I", "Biology 101"]);
  assert.deepEqual(profileLines(undefined), []);
});

test("only mistakes and unfinished answers count as wrong checks, newest first", () => {
  const checks: WorkCheckRecord[] = [
    { label: "Problem 1", status: "error", at: 100 },
    { label: "Problem 2", status: "correct", at: 200 },
    { label: "Problem 3", status: "blank", at: 300 },
    { label: "Problem 4", status: "unreadable", at: 400 },
    { label: "Problem 5", status: "incomplete", topic: "Simplify 3/4 + 1/8.", at: 500 },
  ];
  assert.deepEqual(wrongChecks([chat("a", 0, { work_checks: checks })]), [
    { label: "Problem 5", status: "incomplete", topic: "Simplify 3/4 + 1/8." },
    { label: "Problem 1", status: "error", topic: undefined },
  ]);
});

test("checks saved before `at` existed sort by their chat's start", () => {
  const older = chat("older", 1000, { work_checks: [{ label: "Old", status: "error" }] });
  const newer = chat("newer", 5000, { work_checks: [{ label: "Legacy", status: "error" }, { label: "Timed", status: "error", at: 3000 }] });
  assert.deepEqual(
    wrongChecks([newer, older]).map((check) => check.label),
    ["Legacy", "Timed", "Old"],
  );
  assert.deepEqual(wrongChecks([chat("empty", 0)]), []);
});

test("practice questions come newest first, the open chat's first, each once", () => {
  const many = Array.from({ length: 10 }, (_, index) => `Newer ${index}`);
  const older = chat("older", 1000, { practice_history: ["Old 1", "Old 2", "Shared"] });
  const newer = chat("newer", 5000, { practice_history: ["Shared", ...many] });
  // With the older chat open again, its questions were just written, so they survive the cap.
  const open = recentPractice([newer, older], "older");
  assert.deepEqual(open.slice(0, 3), ["Shared", "Old 2", "Old 1"]);
  assert.equal(open.length, 13, "a duplicate wasn't collapsed");
  // With no chat open, newer chats come first.
  assert.deepEqual(recentPractice([older, newer]).slice(0, 2), ["Newer 9", "Newer 8"]);
  assert.deepEqual(recentPractice([chat("blank", 0)], "blank"), []);
});

test("without fresh data, the source is the profile only when it has something", () => {
  assert.equal(savedSource({ courses: [], upcoming: [] }), "none");
  assert.equal(savedSource({ courses: ["Algebra I"], upcoming: [] }), "profile");
  assert.equal(savedSource({ courses: [], upcoming: ["Quiz (due Fri)"] }), "profile");
});
