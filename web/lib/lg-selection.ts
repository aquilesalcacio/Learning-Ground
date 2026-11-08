// The student's "Show the tutor" marks, in board units: a tap leaves a small ring, and a drag a
// loop that closes itself. lg-point-tool.ts draws them and lg-actions.ts saves them as s1, s2...
// Type-only imports keep it runnable under `node --test` without a bundler.
import type { LgBounds } from "./lg-regions";
import type { LgBoardQuestion } from "./lg-types";

export type SelectionPoint = { x: number; y: number };

export type SelectionStroke = {
  tap: boolean;
  // The ring or the closed loop, as drawn.
  points: SelectionPoint[];
  // What the tutor aims at and Check my work captures, never smaller than SELECTION_MIN.
  bounds: LgBounds;
};

// A drag shorter than this on screen is a tap.
export const TAP_PX = 10;
// A tap's ring, on screen, so it looks the same at any zoom.
export const TAP_RING_PX = 16;
// A circled spot is at least this big on the board, so a tap on a word still takes in the word.
export const SELECTION_MIN = 48;
// The loop is saved with the board, so a long scribble is thinned to this many points.
export const LOOP_POINTS_MAX = 400;
// Points closer than this on screen add nothing to the loop's shape.
const POINT_GAP_PX = 2;
// The closing stretch is drawn in steps about this long, as lg-ink.ts spaces its strokes.
const CLOSE_STEP = 5;
const CLOSE_POINTS_MAX = 100;
// A question's area reaches a little past its note and answer box, as watchAnswers does.
const QUESTION_PADDING = 24;
// Check my work sends the label to the API, which allows 80 characters.
const LABEL_MAX = 80;

export function boundsOf(points: SelectionPoint[]): LgBounds {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// The loop runs on from its last point straight back to its first.
export function closeLoop(points: SelectionPoint[], step = CLOSE_STEP): SelectionPoint[] {
  if (points.length < 2) return [...points];
  const first = points[0];
  const last = points[points.length - 1];
  const count = Math.min(CLOSE_POINTS_MAX, Math.max(1, Math.ceil(Math.hypot(first.x - last.x, first.y - last.y) / step)));
  const closing = Array.from({ length: count }, (_, index) => {
    const t = (index + 1) / count;
    return index === count - 1 ? { ...first } : { x: last.x + (first.x - last.x) * t, y: last.y + (first.y - last.y) * t };
  });
  return [...points, ...closing];
}

// A closed circle, starting and ending at its right.
export function ringPoints(center: SelectionPoint, radius: number): SelectionPoint[] {
  const count = Math.max(16, Math.ceil((Math.PI * 2 * radius) / CLOSE_STEP / 4) * 4);
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = index === count ? 0 : (Math.PI * 2 * index) / count;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
}

// Grows a small spot to the minimum size around its centre.
export function selectionArea(bounds: LgBounds, min = SELECTION_MIN): LgBounds {
  const w = Math.max(bounds.w, min);
  const h = Math.max(bounds.h, min);
  return { x: bounds.x + bounds.w / 2 - w / 2, y: bounds.y + bounds.h / 2 - h / 2, w, h };
}

// Drops points too close to the last one kept, then evens out what's left to at most max.
function thinPoints(points: SelectionPoint[], gap: number, max: number): SelectionPoint[] {
  const kept: SelectionPoint[] = [];
  points.forEach((point, index) => {
    const last = kept[kept.length - 1];
    if (!last || index === points.length - 1 || Math.hypot(point.x - last.x, point.y - last.y) >= gap) kept.push(point);
  });
  if (kept.length <= max) return kept;
  return Array.from({ length: max }, (_, index) => kept[Math.round((index * (kept.length - 1)) / (max - 1))]);
}

// What the student's stroke becomes, from the points the pointer passed through (page
// coordinates) and the zoom it was drawn at. A short drag counts as a tap where it began.
export function selectionStroke(points: SelectionPoint[], zoom: number): SelectionStroke | null {
  if (!points.length) return null;
  const scale = zoom > 0 ? zoom : 1;
  const extent = boundsOf(points);
  if (Math.max(extent.w, extent.h) * scale < TAP_PX) {
    const center = points[0];
    const radius = TAP_RING_PX / scale;
    return {
      tap: true,
      points: ringPoints(center, radius),
      bounds: selectionArea({ x: center.x - radius, y: center.y - radius, w: radius * 2, h: radius * 2 }),
    };
  }
  const loop = closeLoop(thinPoints(points, POINT_GAP_PX / scale, LOOP_POINTS_MAX));
  return { tap: false, points: loop, bounds: selectionArea(boundsOf(loop)) };
}

export type SelectionOwner = { region_id?: string; question_id?: string };

// What a circled spot is on, from its centre: a question the tutor wrote (its note, answer box
// and the room around them), or else the homework region found there. A question wins, since
// the tutor writes them beside a region; the newest wins where two overlap, as it's on top.
export function selectionOwner(
  center: SelectionPoint,
  questions: Pick<LgBoardQuestion, "id" | "card" | "answer">[],
  region_id: string | undefined,
): SelectionOwner {
  for (const question of [...questions].reverse()) {
    const left = Math.min(question.card.x, question.answer.x) - QUESTION_PADDING;
    const top = Math.min(question.card.y, question.answer.y) - QUESTION_PADDING;
    const right = Math.max(question.card.x + question.card.w, question.answer.x + question.answer.w) + QUESTION_PADDING;
    const bottom = Math.max(question.card.y + question.card.h, question.answer.y + question.answer.h) + QUESTION_PADDING;
    if (center.x >= left && center.x <= right && center.y >= top && center.y <= bottom) return { question_id: question.id };
  }
  return region_id ? { region_id } : {};
}

// How Check my work names a circled part, such as "the part the student circled on Problem 3".
export function selectionLabel(on: string): string {
  const label = `the part the student circled on ${on.replace(/\s+/g, " ").trim() || "the board"}`;
  return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1).trimEnd()}…` : label;
}
