// Run from web/: node --test lib/lg-selection.test.ts
// Node strips the types itself, so this needs no test framework.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { LgBoardQuestion } from "./lg-types";

// Node needs the extension and TypeScript rejects it in a static import, so it's loaded here.
const selection = (await import(`./lg-selection${".ts"}`)) as typeof import("./lg-selection");
const {
  boundsOf,
  closeLoop,
  growCluster,
  LOOP_POINTS_MAX,
  ringPoints,
  SELECTION_MIN,
  selectionArea,
  selectionLabel,
  selectionOwner,
  selectionStroke,
  TAP_RING_PX,
} = selection;

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

// Most of a circle, as a student drags it, stopping short of where it began.
function arc(cx: number, cy: number, r: number, count: number, sweep = Math.PI * 1.7) {
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = (sweep * index) / count;
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
  });
}

test("a loop closes itself back to its first point, in small steps", () => {
  const open = arc(200, 200, 80, 40);
  const closed = closeLoop(open, 5);
  assert.deepEqual(closed[closed.length - 1], open[0]);
  assert.deepEqual(closed.slice(0, open.length), open);
  const added = closed.slice(open.length - 1);
  for (let index = 1; index < added.length; index += 1) {
    assert.ok(distance(added[index - 1], added[index]) <= 5.01, `the closing step ${index} is too long`);
  }
  // Already closed: just the first point again.
  const ring = ringPoints({ x: 0, y: 0 }, 20);
  assert.equal(closeLoop(ring, 5).length, ring.length + 1);
  assert.deepEqual(closeLoop([], 5), []);
});

test("bounds hold every point", () => {
  assert.deepEqual(
    boundsOf([
      { x: 10, y: 40 },
      { x: -5, y: 12 },
      { x: 30, y: 20 },
    ]),
    { x: -5, y: 12, w: 35, h: 28 },
  );
});

test("a small spot grows to the minimum size around its centre; a big one stays", () => {
  assert.deepEqual(selectionArea({ x: 100, y: 100, w: 10, h: 80 }), { x: 105 - SELECTION_MIN / 2, y: 100, w: SELECTION_MIN, h: 80 });
  assert.deepEqual(selectionArea({ x: 0, y: 0, w: 200, h: 120 }), { x: 0, y: 0, w: 200, h: 120 });
});

test("a tap leaves a small fixed ring at the pressed point", () => {
  const press = [
    { x: 300, y: 200 },
    { x: 302, y: 201 },
  ];
  const tap = selectionStroke(press, 1);
  assert.ok(tap);
  assert.equal(tap.tap, true);
  // The ring is the same size on screen at any zoom.
  for (const point of tap.points) assert.ok(Math.abs(distance(point, press[0]) - TAP_RING_PX) < 0.01);
  assert.deepEqual(tap.points[0], tap.points[tap.points.length - 1]);
  assert.deepEqual(tap.bounds, { x: 300 - SELECTION_MIN / 2, y: 200 - SELECTION_MIN / 2, w: SELECTION_MIN, h: SELECTION_MIN });
  const zoomedOut = selectionStroke(press, 0.5);
  assert.ok(zoomedOut?.tap);
  assert.ok(Math.abs(distance(zoomedOut.points[0], press[0]) - TAP_RING_PX * 2) < 0.01);
});

test("whether a drag is a tap depends on how far it went on screen", () => {
  const short = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
  ];
  assert.equal(selectionStroke(short, 1)?.tap, true);
  // The same drag zoomed in four times is 24 pixels long.
  assert.equal(selectionStroke(short, 4)?.tap, false);
  assert.equal(selectionStroke([], 1), null);
});

test("a drag becomes a closed loop with its own bounds", () => {
  const open = arc(400, 300, 100, 200);
  const loop = selectionStroke(open, 1);
  assert.ok(loop);
  assert.equal(loop.tap, false);
  assert.deepEqual(loop.points[loop.points.length - 1], loop.points[0]);
  assert.ok(Math.abs(loop.bounds.x - 300) < 1 && Math.abs(loop.bounds.w - 200) < 1, `bounds ${JSON.stringify(loop.bounds)}`);
  // A slow drag reports points a pixel apart: thinning keeps its shape.
  const slow = selectionStroke(arc(400, 300, 100, 600), 1);
  assert.ok(slow && Math.abs(slow.bounds.w - 200) < 2, `slow drag bounds ${JSON.stringify(slow?.bounds)}`);
  assert.ok(slow.points.length > 100, `only ${slow.points.length} points kept`);
  // A long scribble is thinned, so the saved shape stays small.
  const scribble = Array.from({ length: 5000 }, (_, index) => ({ x: (index % 100) * 4, y: Math.floor(index / 100) * 4 }));
  const thinned = selectionStroke(scribble, 1);
  assert.ok(thinned && thinned.points.length <= LOOP_POINTS_MAX + 101, `${thinned?.points.length} points`);
});

const question = (id: string, x: number, y: number): Pick<LgBoardQuestion, "id" | "card" | "answer"> => ({
  id,
  card: { x, y, w: 200, h: 200 },
  answer: { x, y: y + 240, w: 300, h: 150 },
});

test("a circle on a question belongs to the question, even over a region", () => {
  const questions = [question("q1", 1000, 0), question("q2", 1000, 100)];
  assert.deepEqual(selectionOwner({ x: 1100, y: 50 }, questions, "p1.q3"), { question_id: "q1" });
  // Two questions overlap: the newer one, drawn on top, wins.
  assert.deepEqual(selectionOwner({ x: 1100, y: 150 }, questions, "p1.q3"), { question_id: "q2" });
  // Its answer box counts, with a little room around it.
  assert.deepEqual(selectionOwner({ x: 1310, y: 500 }, questions, undefined), { question_id: "q2" });
  assert.deepEqual(selectionOwner({ x: 200, y: 200 }, questions, "p1.q3"), { region_id: "p1.q3" });
  assert.deepEqual(selectionOwner({ x: 200, y: 200 }, questions, undefined), {});
});

test("the label for a circled part stays within the API's 80 characters", () => {
  assert.equal(selectionLabel("Problem 3"), "the part the student circled on Problem 3");
  assert.equal(selectionLabel(""), "the part the student circled on the board");
  const long = selectionLabel(`Question 1: ${"How many apples are left ".repeat(6)}`);
  assert.ok(long.length <= 80, `${long.length} characters`);
  assert.ok(long.endsWith("…"));
});

// Strokes as their board bounds. Each pen stroke is its own shape, so a drawing is many of these.
const box = (x: number, y: number, w = 20, h = 20) => ({ x, y, w, h });

test("a drawing beside the answer box comes whole, not just the stroke that crosses it", () => {
  const answer = box(0, 0, 300, 150);
  // A graph to the right: its axis crosses the box, its curve and labels are 30-50 units apart.
  const strokes = [box(280, 60, 200, 4), box(300, 20, 4, 120), box(330, 30, 120, 80), box(470, 0, 30, 20), box(470, 120, 30, 20)];
  assert.deepEqual(growCluster(answer, strokes).sort(), [0, 1, 2, 3, 4]);
});

test("strokes that don't touch the drawing stay out", () => {
  const answer = box(0, 0, 300, 150);
  const strokes = [box(100, 50), box(1200, 50), box(100, 900)];
  assert.deepEqual(growCluster(answer, strokes), [0]);
});

test("nothing touching the area means nothing is taken", () => {
  assert.deepEqual(growCluster(box(0, 0, 300, 150), [box(600, 0), box(630, 0)]), []);
});

test("a long chain of strokes can't sweep in the whole board", () => {
  const answer = box(0, 0, 300, 150);
  // Strokes every 50 units, running far off to the right.
  const strokes = Array.from({ length: 60 }, (_, index) => box(290 + index * 50, 60));
  const taken = growCluster(answer, strokes);
  assert.ok(taken.length > 3 && taken.length < 60, `${taken.length} strokes taken`);
  for (const index of taken) assert.ok(strokes[index].x <= 300 + 900, `stroke at x ${strokes[index].x}`);
});
