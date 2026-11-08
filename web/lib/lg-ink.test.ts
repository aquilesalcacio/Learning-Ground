// Run from web/: node --test lib/lg-ink.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

// Node needs the extension and TypeScript rejects it in a static import, so it's loaded here.
const ink = (await import(`./lg-ink${".ts"}`)) as typeof import("./lg-ink");
const {
  arcAt,
  arrowEnds,
  formatNumber,
  highlightPoints,
  inkRandom,
  labelledTicks,
  loopPoints,
  niceStep,
  numberLineLayout,
  numberLineStroke,
  parseNumber,
  parseNumberLineMarks,
  partialPath,
  roundedRectPoints,
  pathLength,
  typedText,
  underlinePoints,
} = ink;

const box = { x: 100, y: 200, w: 400, h: 60 };

test("inkRandom repeats for a seed and differs between seeds", () => {
  const first = inkRandom("p1.q3");
  const again = inkRandom("p1.q3");
  const other = inkRandom("p1.q4");
  const a = [first(), first(), first()];
  assert.deepEqual(a, [again(), again(), again()]);
  assert.notDeepEqual(a, [other(), other(), other()]);
  assert.ok(a.every((value) => value >= 0 && value < 1));
});

test("loopPoints encloses the box and overshoots its start", () => {
  const points = loopPoints(box, "p1.q3");
  assert.deepEqual(points, loopPoints(box, "p1.q3"));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  // The oval clears every edge of the box.
  assert.ok(Math.min(...xs) < box.x && Math.max(...xs) > box.x + box.w);
  assert.ok(Math.min(...ys) < box.y && Math.max(...ys) > box.y + box.h);
  // More than one turn, so it's longer than the ellipse itself.
  const rx = box.w / 2;
  const ry = box.h / 2;
  const ellipse = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  assert.ok(pathLength(points) > ellipse);
  // Starts at the upper left.
  assert.ok(points[0].x < box.x + box.w / 2 && points[0].y < box.y + box.h / 2);
});

test("underlinePoints runs below the box, left to right", () => {
  const points = underlinePoints(box, "p1.q3");
  assert.ok(points.every((point) => point.y > box.y + box.h));
  assert.ok(points[0].x < points[points.length - 1].x);
  assert.ok(points[0].x >= box.x - 2 && points[points.length - 1].x <= box.x + box.w + 2);
});

test("highlightPoints covers a tall box with several passes", () => {
  const tall = { x: 0, y: 0, w: 300, h: 120 };
  const points = highlightPoints(tall, "p2.q1", 27);
  const ys = points.map((point) => point.y);
  assert.ok(Math.min(...ys) < 20 && Math.max(...ys) > 100);
  // A one-line box is a single pass across.
  const line = highlightPoints({ x: 0, y: 0, w: 300, h: 20 }, "p2.q1", 27);
  assert.ok(line[0].x < line[line.length - 1].x);
  assert.ok(line.every((point) => Math.abs(point.y - 10) < 4));
});

test("partialPath stops at the share of the length, on the line", () => {
  const line = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];
  assert.deepEqual(partialPath(line, 0), [{ x: 0, y: 0 }]);
  assert.deepEqual(partialPath(line, 0.25), [
    { x: 0, y: 0 },
    { x: 5, y: 0 },
  ]);
  assert.deepEqual(partialPath(line, 0.75), [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 5 },
  ]);
  assert.deepEqual(partialPath(line, 1), line);
});

test("arrowEnds bends the other way going up", () => {
  const top = { x: 0, y: 0, w: 100, h: 20 };
  const bottom = { x: 0, y: 200, w: 100, h: 20 };
  assert.deepEqual(arrowEnds(top, bottom), { start: { x: 0, y: 10 }, end: { x: 0, y: 210 }, bend: 40 });
  assert.equal(arrowEnds(bottom, top).bend, -40);
});

test("arcAt grows a curved arrow along its final arc", () => {
  const start = { x: 0, y: 0 };
  const end = { x: 0, y: 200 };
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  // Halfway, the tip is the curve's middle: the chord's midpoint pushed out by the bend,
  // along tldraw's normal, which is (-u.y, u.x) for the unit chord u.
  const half = arcAt(start, end, 40, 0.5);
  assert.ok(close(half.point.x, -40) && close(half.point.y, 100));
  // The full arrow is unchanged, and a straight one grows along its chord.
  assert.deepEqual(arcAt(start, end, 40, 1), { point: end, bend: 40 });
  assert.deepEqual(arcAt(start, end, 0, 0.25), { point: { x: 0, y: 50 }, bend: 0 });
  // A shorter arrow keeps the same side and a smaller bend.
  const quarter = arcAt(start, end, 40, 0.25);
  assert.ok(quarter.bend > 0 && quarter.bend < 40);
  const up = arcAt(end, start, -40, 0.5);
  assert.ok(close(up.point.x, -40) && close(up.point.y, 100));
});

test("niceStep keeps ticks at ten or fewer, on round numbers", () => {
  assert.equal(niceStep(10), 1);
  assert.equal(niceStep(1), 0.1);
  assert.equal(niceStep(30), 5);
  assert.equal(niceStep(200), 20);
});

test("numberLineLayout places ticks and marks along the axis", () => {
  const layout = numberLineLayout({ x: 0, y: 0 }, 300, -2, 2, [{ value: 0.5, label: "1/2" }, { value: 9 }]);
  assert.ok(layout);
  assert.deepEqual(
    layout.ticks.map((tick) => tick.label),
    ["-2", "-1.5", "-1", "-0.5", "0", "0.5", "1", "1.5", "2"],
  );
  // Out of range marks are dropped.
  assert.equal(layout.dots.length, 1);
  assert.equal(layout.dots[0].label, "1/2");
  const zero = layout.ticks.find((tick) => tick.label === "0");
  assert.ok(zero && layout.dots[0].x > zero.x);
  assert.equal(numberLineLayout({ x: 0, y: 0 }, 300, 3, 3), null);
  assert.equal(numberLineLayout({ x: 0, y: 0 }, 300, Number.NaN, 3), null);
});

test("numberLineStroke runs left to right through every tick", () => {
  const layout = numberLineLayout({ x: 0, y: 0 }, 300, 0, 4);
  assert.ok(layout);
  const stroke = numberLineStroke(layout);
  const [left, right] = layout.axis;
  assert.ok(stroke.every((point) => point.x >= left.x - 0.01 && point.x <= right.x + 0.01));
  for (const tick of layout.ticks) {
    assert.ok(stroke.some((point) => Math.abs(point.x - tick.x) < 0.01 && Math.abs(point.y - (layout.y - 7)) < 0.01));
  }
  // Evenly spaced, so tldraw draws an even line.
  for (let index = 1; index < stroke.length; index += 1) {
    assert.ok(Math.hypot(stroke[index].x - stroke[index - 1].x, stroke[index].y - stroke[index - 1].y) <= 3.01);
  }
  // Half steps are ticked, and the whole numbers labelled.
  assert.deepEqual(
    labelledTicks(layout).map((tick) => tick.label),
    ["0", "1", "2", "3", "4"],
  );
  const crowded = numberLineLayout({ x: 0, y: 0 }, 300, -4, 4);
  assert.ok(crowded && labelledTicks(crowded).length < crowded.ticks.length);
});

test("roundedRectPoints traces the box and closes where it started", () => {
  const bounds = { x: 10, y: 20, w: 300, h: 150 };
  const points = roundedRectPoints(bounds, 12);
  assert.deepEqual(points[0], points[points.length - 1]);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  assert.ok(close(Math.min(...xs), 10) && close(Math.max(...xs), 310));
  assert.ok(close(Math.min(...ys), 20) && close(Math.max(...ys), 170));
});

test("parseNumberLineMarks reads values, fractions and labels", () => {
  assert.deepEqual(parseNumberLineMarks("1/2, 0.75:three quarters; -2, x, 3:"), [
    { value: 0.5, label: "1/2" },
    { value: 0.75, label: "three quarters" },
    { value: -2 },
    { value: 3 },
  ]);
  assert.deepEqual(parseNumberLineMarks(""), []);
  assert.equal(parseNumber("\u22123/4"), -0.75);
  assert.ok(Number.isNaN(parseNumber("half")));
});

test("formatNumber trims float noise", () => {
  assert.equal(formatNumber(0.1 + 0.2), "0.3");
  assert.equal(formatNumber(-0), "0");
  assert.equal(formatNumber(2), "2");
});

test("typedText never splits a character", () => {
  assert.equal(typedText("Olá 👋", 0), "");
  assert.equal(typedText("Olá 👋", 0.5), "Olá");
  assert.equal(typedText("Olá 👋", 1), "Olá 👋");
});
