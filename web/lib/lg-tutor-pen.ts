"use client";

import type { Editor } from "tldraw";
import { easeInOutCubic, easeOutBack, easeOutCubic, type InkPoint } from "./lg-ink";
import { getActiveTutor, readLgState } from "./lg-store";
import { resolveTone } from "./lg-tutor-prompt";

// The tutor's pen. Every mark the tutor makes is a list of steps played one at a time, so the
// pen travels to a problem and draws there by hand while the tutor talks. lg-actions.ts builds
// the steps; components/tutor-cursor.tsx draws the pen itself from getPen().
//
// Rules the queue keeps:
// - Marks start with the tutor's voice: a step marked hold waits up to HOLD_MS for speech.
// - Nothing animates while the student's pen is down. The queue waits for it to lift.
// - Every change is kept out of the undo history, so the student's undo never takes a tutor mark.
// - flushPen() finishes everything at once: on a chat switch, a hidden tab or reduced motion.

export type PenMode = "idle" | "travel" | "draw" | "point" | "think";

export type PenStep = {
  // Where the pen goes before the step starts, in page coordinates. Read when the step starts,
  // so it sees the marks made before it.
  at?: () => InkPoint | null;
  // Waits for the tutor's voice before starting (voice sessions only).
  hold?: boolean;
  // How long the step takes at normal speed, in ms. Infinity runs until done() returns true.
  duration: number;
  mode: PenMode;
  begin?: () => void;
  // t runs from 0 to 1. Returns where the pen tip is now, or nothing to leave it where it is.
  frame?: (t: number, elapsed: number) => InkPoint | void;
  // Writes the step's final state. Always called, also when a flush skips to the end.
  end?: () => void;
  // Open-ended steps end once this returns true.
  done?: () => boolean;
  // Ended at once when another step is waiting.
  skippable?: boolean;
};

export type PenState = {
  visible: boolean;
  // The tip, in page coordinates.
  x: number;
  y: number;
  mode: PenMode;
  // performance.now() of the pen's last movement. The cursor dims after a while.
  activeAt: number;
  // When a tap or a celebration last started, for the cursor's one-off effects.
  tapAt: number;
  celebrateAt: number;
  thinking: boolean;
};

export type PenVoice = { live: boolean; textOnly: boolean; speaking: boolean; level: () => number };

const HOLD_MS = 700;
// An open-ended step never runs longer than this, in case its done() never comes.
const OPEN_MAX_MS = 45_000;
const HIDE_IDLE_MS = 9_000;
const HIDE_AFTER_SESSION_MS = 4_000;
// The student's pen pauses the tutor's, except while selecting or panning.
const QUIET_TOOLS = new Set(["select", "hand"]);

const pen: PenState = {
  visible: false,
  x: 0,
  y: 0,
  mode: "idle",
  activeAt: 0,
  tapAt: 0,
  celebrateAt: 0,
  thinking: false,
};

let voice: PenVoice = { live: false, textOnly: false, speaking: false, level: () => 0 };

type Queued = { step: PenStep; queuedAt: number };
type Running = Queued & {
  phase: "travel" | "hold" | "run";
  from: InkPoint;
  to: InkPoint | null;
  travelMs: number;
  arc: number;
  elapsed: number;
  begun: boolean;
};

let editor: Editor | null = null;
const queue: Queued[] = [];
let running: Running | null = null;
let frameId = 0;
let lastTime = 0;
let interrupted = false;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let arcSide = 1;

// React reads a small snapshot that changes only with what the cursor renders differently.
type PenSnapshot = { visible: boolean; mode: PenMode; thinking: boolean };
let snapshot: PenSnapshot = { visible: false, mode: "idle", thinking: false };
const listeners = new Set<() => void>();

function notify() {
  const next = { visible: pen.visible, mode: pen.mode, thinking: pen.thinking };
  if (next.visible === snapshot.visible && next.mode === snapshot.mode && next.thinking === snapshot.thinking) return;
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function subscribePen(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPenSnapshot(): PenSnapshot {
  return snapshot;
}

// The live pen, read every animation frame. Never written outside this file.
export function getPen(): Readonly<PenState> {
  return pen;
}

export function getPenVoice(): Readonly<PenVoice> {
  return voice;
}

// The voice session tells the pen when the tutor speaks, so marks wait for the voice.
export function setPenVoice(patch: Partial<PenVoice>) {
  const wasLive = voice.live;
  voice = { ...voice, ...patch };
  if (wasLive && !voice.live) scheduleHide(HIDE_AFTER_SESSION_MS);
}

export function getPenLevel(): number {
  if (!voice.live) return 0;
  try {
    return Math.min(1, Math.max(0, voice.level() || 0));
  } catch {
    return 0;
  }
}

// The student talked over the tutor: what's queued plays three times faster, so the board
// catches up with the conversation instead of dropping marks.
export function penInterrupted() {
  if (running || queue.length) interrupted = true;
}

export function penCelebrate() {
  pen.celebrateAt = performance.now();
  pen.activeAt = pen.celebrateAt;
}

function setThinking(thinking: boolean) {
  pen.thinking = thinking;
  notify();
}

function setMode(mode: PenMode) {
  pen.mode = mode;
  notify();
}

function movePen(point: InkPoint) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  pen.x = point.x;
  pen.y = point.y;
  pen.activeAt = performance.now();
}

function showPen() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  if (pen.visible) return;
  // The pen comes out of the tutor's orb, docked at the bottom left of the board.
  const e = editor;
  if (e) {
    const screen = e.getViewportScreenBounds();
    movePen(e.screenToPage({ x: screen.x + 44, y: screen.y + screen.h - 40 }));
  }
  pen.visible = true;
  notify();
}

function scheduleHide(after: number) {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (running || queue.length || pen.thinking) return;
    pen.visible = false;
    notify();
  }, after);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Runs board changes outside the undo history, returning what fn returns.
function quietly<T>(fn: () => T): T {
  const e = editor;
  if (!e) return fn();
  let value!: T;
  e.run(
    () => {
      value = fn();
    },
    { history: "ignore" },
  );
  return value;
}

// Each tutor tone moves the pen its own way: springy, relaxed or exact.
function travelEase(): (t: number) => number {
  const tone = resolveTone(getActiveTutor(readLgState()));
  return tone === "humorous" ? easeOutBack : tone === "formal" ? easeInOutCubic : easeOutCubic;
}

function studentDrawing(e: Editor): boolean {
  return e.inputs.getIsPointing() && !QUIET_TOOLS.has(e.getCurrentToolId());
}

function speed(): number {
  const backlog = 1 + Math.max(0, queue.length - 2) * 0.25;
  return Math.min(3, Math.max(interrupted ? 3 : 1, backlog));
}

function prepare(item: Queued): Running {
  showPen();
  const to = item.step.at?.() ?? null;
  const from = { x: pen.x, y: pen.y };
  const zoom = editor?.getZoomLevel() ?? 1;
  const distance = to ? Math.hypot(to.x - from.x, to.y - from.y) * zoom : 0;
  // Far trips take longer, but never so long that the pen lags the voice.
  const travelMs = distance > 2 ? Math.min(420, Math.max(160, 140 + distance * 0.35)) : 0;
  if (to && !travelMs) movePen(to);
  arcSide = -arcSide;
  return {
    ...item,
    phase: travelMs ? "travel" : item.step.hold ? "hold" : "run",
    from,
    to,
    travelMs,
    arc: arcSide * Math.min(36 / zoom, (distance / zoom) * 0.12),
    elapsed: 0,
    begun: false,
  };
}

// The pen swings a little on its way, as a hand does, instead of sliding in a straight line.
function travel(item: Running, t: number) {
  const { from, to } = item;
  if (!to) return;
  const eased = travelEase()(t);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const swing = Math.sin(Math.PI * Math.min(t, 1)) * item.arc;
  movePen({ x: from.x + dx * eased - (dy / length) * swing, y: from.y + dy * eased + (dx / length) * swing });
}

function finish(item: Running) {
  quietly(() => {
    if (!item.begun) item.step.begin?.();
    item.step.end?.();
  });
}

function advance(now: number, dt: number) {
  if (running?.step.skippable && queue.length) {
    finish(running);
    running = null;
  }
  if (!running) {
    const next = queue.shift();
    if (!next) return;
    running = prepare(next);
  }
  const item = running;
  const step = item.step;
  if (item.phase === "travel") {
    if (pen.mode !== "travel") setMode("travel");
    item.elapsed += dt * speed();
    const t = Math.min(1, item.elapsed / item.travelMs);
    travel(item, t);
    if (t < 1) return;
    item.phase = step.hold ? "hold" : "run";
    item.elapsed = 0;
  }
  if (item.phase === "hold") {
    const waiting = voice.live && !voice.textOnly && !voice.speaking && now - item.queuedAt < HOLD_MS;
    if (waiting) {
      if (pen.mode !== "idle") setMode("idle");
      return;
    }
    item.phase = "run";
    item.elapsed = 0;
  }
  if (!item.begun) {
    quietly(() => step.begin?.());
    item.begun = true;
  }
  if (pen.mode !== step.mode) setMode(step.mode);
  item.elapsed += dt * speed();
  const open = !Number.isFinite(step.duration);
  const t = open ? 0 : step.duration <= 0 ? 1 : Math.min(1, item.elapsed / step.duration);
  const tip = quietly(() => step.frame?.(t, item.elapsed));
  if (tip) movePen(tip);
  const ended = open ? (step.done?.() ?? true) || item.elapsed > OPEN_MAX_MS : t >= 1;
  if (!ended) return;
  quietly(() => step.end?.());
  running = null;
}

function tick(now: number) {
  frameId = 0;
  const e = editor;
  if (!e) return;
  // A long frame, such as after the tab was in the background, counts as one ordinary frame.
  const dt = Math.min(48, Math.max(0, now - lastTime));
  lastTime = now;
  if (!studentDrawing(e)) advance(now, dt);
  if (running || queue.length) {
    frameId = requestAnimationFrame(tick);
    return;
  }
  interrupted = false;
  setMode("idle");
  if (!pen.thinking) scheduleHide(voice.live ? HIDE_IDLE_MS * 4 : HIDE_IDLE_MS);
}

function startLoop() {
  if (frameId) return;
  lastTime = performance.now();
  frameId = requestAnimationFrame(tick);
}

// Queues the steps of one mark. With reduced motion, the mark appears at once.
export function enqueuePen(steps: PenStep[]) {
  if (!editor || !steps.length) return;
  const queuedAt = performance.now();
  for (const step of steps) queue.push({ step, queuedAt });
  showPen();
  if (prefersReducedMotion()) {
    flushPen();
    return;
  }
  startLoop();
}

// Finishes the running step and everything queued, at once and in order.
export function flushPen() {
  if (frameId) cancelAnimationFrame(frameId);
  frameId = 0;
  if (running) {
    const item = running;
    running = null;
    quietly(() => {
      if (!item.begun) item.step.begin?.();
      const tip = item.step.frame?.(1, 0);
      if (tip) movePen(tip);
      item.step.end?.();
    });
  }
  while (queue.length) {
    const { step } = queue.shift() as Queued;
    const at = step.at?.();
    if (at) movePen(at);
    quietly(() => {
      step.begin?.();
      const tip = step.frame?.(1, 0);
      if (tip) movePen(tip);
      step.end?.();
    });
  }
  interrupted = false;
  setMode("idle");
  if (pen.visible && !pen.thinking) scheduleHide(voice.live ? HIDE_IDLE_MS * 4 : HIDE_IDLE_MS);
}

// While the tutor reads the student's work, the pen hovers over it in small loops.
let looking = false;

export function penLook(at: InkPoint | null) {
  looking = true;
  setThinking(true);
  if (!at || !editor) return;
  const radius = () => 9 / (editor?.getZoomLevel() ?? 1);
  enqueuePen([
    {
      at: () => at,
      duration: Infinity,
      mode: "think",
      frame: (_t, elapsed) => {
        const angle = (elapsed / 900) * Math.PI * 2;
        return { x: at.x + Math.cos(angle) * radius() - radius(), y: at.y + Math.sin(angle) * radius() };
      },
      done: () => !looking,
      end: () => movePen(at),
    },
  ]);
}

export function penDoneLooking(celebrate = false) {
  looking = false;
  setThinking(false);
  if (celebrate) penCelebrate();
  // A hide that came due while it was looking was skipped, so it's set again.
  if (pen.visible && !running && !queue.length) scheduleHide(voice.live ? HIDE_IDLE_MS * 4 : HIDE_IDLE_MS);
}

// A tap with a ripple: "look here", with no ink.
export function penTapStep(at: () => InkPoint | null): PenStep {
  let spot: InkPoint | null = null;
  return {
    at: () => (spot = at()),
    hold: true,
    duration: 650,
    mode: "point",
    begin: () => {
      pen.tapAt = performance.now();
    },
    frame: (t) => {
      if (!spot) return;
      // A small press down and back up.
      const press = Math.sin(Math.min(t / 0.35, 1) * Math.PI) * 4;
      return { x: spot.x, y: spot.y + press / (editor?.getZoomLevel() ?? 1) };
    },
  };
}

// After a mark, the pen eases off to one side of it (by default a little down and right), so the
// cursor and its name tag never sit on top of what it drew.
export function penRestStep(beside?: () => InkPoint | null): PenStep {
  let from: InkPoint = { x: 0, y: 0 };
  let to: InkPoint = { x: 0, y: 0 };
  return {
    duration: 520,
    mode: "idle",
    skippable: true,
    begin: () => {
      from = { x: pen.x, y: pen.y };
      const zoom = editor?.getZoomLevel() ?? 1;
      to = beside?.() ?? { x: from.x + 18 / zoom, y: from.y + 16 / zoom };
    },
    frame: (t) => {
      const eased = easeOutCubic(t);
      return { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased };
    },
  };
}

// Connects the pen to an open board. Returns the function that disconnects it, which first
// finishes any mark still being drawn, so the board is never saved with half a mark.
export function attachPen(next: Editor) {
  flushPen();
  editor = next;
  pen.visible = false;
  looking = false;
  pen.thinking = false;
  notify();
  const onVisibility = () => {
    if (document.hidden) flushPen();
  };
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    if (editor !== next) return;
    flushPen();
    editor = null;
    pen.visible = false;
    notify();
  };
}
