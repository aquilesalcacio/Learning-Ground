// Run from web/: node --test lib/lg-ink.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

// Node needs the extension and TypeScript rejects it in a static import, so it's loaded here.
const ink = (await import(`./lg-ink${".ts"}`)) as typeof import("./lg-ink");
const {
  arcAt,
  arrowEnds,
  axisStroke,
  circlePoints,
  densify,
  formatNumber,
  highlightPoints,
  inkRandom,
  labelledTicks,
  lineEnds,
  loopPoints,
  isMarkVerdict,
  MARK_STROKE_KINDS,
  MARK_VERDICTS,
  markBox,
  markStrokes,
  markVerdictFor,
  niceStep,
  numberLineLayout,
  numberLineStroke,
  parseNumber,
  parseNumberLineMarks,
  parseShapeLabels,
  partialPath,
  polygonPoints,
  rightAnglePoints,
  SHAPE_KINDS,
  shapeLayout,
  roundedRectPoints,
  pathLength,
  typedText,
  underlinePoints,
  wedgePoints,
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

const near = (a: { x: number; y: number }, b: { x: number; y: number }, within: number) => Math.hypot(a.x - b.x, a.y - b.y) <= within;
// The largest gap between neighbouring points: tldraw draws a stroke thin where they're far apart.
const widestGap = (points: { x: number; y: number }[]) =>
  points.slice(1).reduce((most, point, index) => Math.max(most, Math.hypot(point.x - points[index].x, point.y - points[index].y)), 0);

test("axisStroke runs to its arrowhead with a tick across the axis at each mark", () => {
  const ticks = [
    { x: 50, y: 100 },
    { x: 100, y: 100 },
  ];
  const stroke = axisStroke({ x: 0, y: 100 }, { x: 200, y: 100 }, ticks);
  assert.deepEqual(stroke[0], { x: 0, y: 100 });
  assert.ok(stroke.some((point) => near(point, { x: 200, y: 100 }, 0.01)));
  for (const tick of ticks) {
    assert.ok(stroke.some((point) => near(point, { x: tick.x, y: tick.y - 5 }, 0.01)));
    assert.ok(stroke.some((point) => near(point, { x: tick.x, y: tick.y + 5 }, 0.01)));
  }
  assert.ok(stroke.every((point) => point.x <= 200.01 && Math.abs(point.y - 100) <= 5.01));
  assert.ok(widestGap(stroke) <= 3.01);
  // An upright axis ticks sideways.
  const up = axisStroke({ x: 10, y: 200 }, { x: 10, y: 0 }, [{ x: 10, y: 100 }]);
  assert.ok(up.some((point) => near(point, { x: 5, y: 100 }, 0.01)) && up.some((point) => near(point, { x: 15, y: 100 }, 0.01)));
});

test("polygonPoints passes each corner and closes a little past its start", () => {
  const corners = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
    { x: 0, y: 100 },
  ];
  const points = polygonPoints(corners, "rect");
  assert.deepEqual(points, polygonPoints(corners, "rect"));
  assert.notDeepEqual(points, polygonPoints(corners, "other"));
  for (const corner of corners) assert.ok(points.some((point) => near(point, corner, 2)), `misses ${JSON.stringify(corner)}`);
  // Hand-drawn, but never far from the true outline.
  assert.ok(points.every((point) => point.x > -4 && point.x < 204 && point.y > -4 && point.y < 104));
  assert.ok(near(points[points.length - 1], points[0], 6));
  assert.ok(widestGap(points) <= 5.5);
});

test("circlePoints goes a little more than once round, close to the radius", () => {
  const center = { x: 100, y: 100 };
  const points = circlePoints(center, 50, "c");
  assert.ok(points.every((point) => Math.abs(Math.hypot(point.x - center.x, point.y - center.y) - 50) < 2));
  assert.ok(pathLength(points) > 2 * Math.PI * 50);
  assert.ok(widestGap(points) <= 5.5);
});

test("wedgePoints closes a slice from the centre out and back", () => {
  const center = { x: 0, y: 0 };
  const wedge = wedgePoints(center, 40, -Math.PI / 2, 0);
  assert.deepEqual(wedge[0], center);
  assert.ok(near(wedge[wedge.length - 1], center, 0.01));
  assert.ok(wedge.some((point) => near(point, { x: 0, y: -40 }, 0.01)) && wedge.some((point) => near(point, { x: 40, y: 0 }, 0.01)));
  // Only the top-right quarter.
  assert.ok(wedge.every((point) => point.x >= -0.01 && point.y <= 0.01));
});

test("rightAnglePoints draws the small square in the corner", () => {
  const marker = rightAnglePoints({ x: 0, y: 100 }, { x: 0, y: -1 }, { x: 1, y: 0 }, 14);
  assert.ok(near(marker[0], { x: 0, y: 86 }, 0.01));
  assert.ok(marker.some((point) => near(point, { x: 14, y: 86 }, 0.01)));
  assert.ok(near(marker[marker.length - 1], { x: 14, y: 100 }, 0.01));
});

test("densify keeps points close on long straight runs", () => {
  const points = densify([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ]);
  assert.ok(points.length > 20 && widestGap(points) <= 5.01);
});

test("parseShapeLabels reads names, values and question marks", () => {
  assert.deepEqual(parseShapeLabels("a=3, b=4, c=?"), [
    { text: "a=3", key: "a", value: 3, whole: false },
    { text: "b=4", key: "b", value: 4, whole: false },
    { text: "c=?", key: "c", value: Number.NaN, whole: false },
  ]);
  assert.deepEqual(parseShapeLabels("r = 5 cm; 1/2"), [
    { text: "r = 5 cm", key: "r", value: 5, whole: false },
    { text: "1/2", key: "", value: 0.5, whole: false },
  ]);
  // A capital A or P, area or perimeter names the whole shape; a small a is still a side.
  assert.deepEqual(
    parseShapeLabels("A=?, P=?, area=12, Perimeter=?, a=2").map((label) => [label.key, label.whole]),
    [
      ["a", true],
      ["p", true],
      ["area", true],
      ["perimeter", true],
    ],
  );
  assert.equal(parseShapeLabels("a=2")[0].whole, false);
  assert.deepEqual(parseShapeLabels(""), []);
  assert.equal(parseShapeLabels("1, 2, 3, 4, 5, 6").length, 4);
  assert.ok(parseShapeLabels("x".repeat(40))[0].text.length <= 14);
});

// Every point of every stroke, and every label's centre.
function allPoints(layout: NonNullable<ReturnType<typeof shapeLayout>>) {
  return [...layout.strokes.flatMap((stroke) => stroke.points), ...layout.labels.map((label) => label.at)];
}

test("every shape fits its box, which fits the margin beside a problem", () => {
  for (const kind of SHAPE_KINDS) {
    const layout = shapeLayout(kind, { labels: "a=3, b=4, c=?", parts: 4, shaded: 1 }, kind);
    assert.ok(layout, kind);
    assert.ok(layout.box.w <= 300 && layout.box.h <= 240, `${kind} is ${layout.box.w} by ${layout.box.h}`);
    const outline = layout.strokes.filter((stroke) => stroke.kind === "outline");
    assert.equal(outline.length, 1, `${kind} has ${outline.length} outlines`);
    assert.equal(layout.strokes[0].kind, "outline", `${kind} doesn't start with its outline`);
    for (const point of allPoints(layout)) {
      const inside = point.x >= 0 && point.x <= layout.box.w && point.y >= 0 && point.y <= layout.box.h;
      assert.ok(inside, `${kind} spills out at ${JSON.stringify(point)}`);
    }
    assert.deepEqual(layout, shapeLayout(kind, { labels: "a=3, b=4, c=?", parts: 4, shaded: 1 }, kind), `${kind} isn't repeatable`);
  }
  assert.equal(shapeLayout("hexagon", {}, "x"), null);
});

test("a right triangle has its right angle marked and its sides labelled in order", () => {
  const layout = shapeLayout("right_triangle", { labels: "a=3, b=4, c=?" }, "t");
  assert.ok(layout);
  assert.equal(layout.strokes.filter((stroke) => stroke.kind === "marker").length, 1);
  assert.deepEqual(
    layout.labels.map((label) => label.text),
    ["a=3", "b=4", "c=?"],
  );
  const [a, b, c] = layout.labels.map((label) => label.at);
  const outline = layout.strokes[0].points;
  const xs = outline.map((point) => point.x);
  const ys = outline.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  // Legs 3 and 4 give a 4 by 3 triangle: a is the upright leg on the left, b the bottom one.
  assert.ok(Math.abs(width / height - 4 / 3) < 0.1, `${width} by ${height}`);
  assert.ok(a.x < Math.min(...xs) && b.y > Math.max(...ys));
  // The long side's label sits outside it, up and to the right of the middle.
  assert.ok(c.x > (Math.min(...xs) + Math.max(...xs)) / 2 && c.y < (Math.min(...ys) + Math.max(...ys)) / 2);
});

test("an area or perimeter label goes under the shape, not on a side", () => {
  // Every label's text, and whether it sits under the outline.
  const placed = (kind: string, labels: string) => {
    const layout = shapeLayout(kind, { labels }, kind);
    assert.ok(layout, kind);
    const bottom = Math.max(...layout.strokes[0].points.map((point) => point.y));
    const box = layout.box;
    for (const point of allPoints(layout)) assert.ok(point.y <= box.h && point.x <= box.w, `${kind} spills out`);
    return Object.fromEntries(layout.labels.map((label) => [label.text, label.at.y > bottom + 24]));
  };
  // The legs of a 3, 4 right triangle are on their sides, and the area under it.
  assert.deepEqual(placed("right_triangle", "a=3, b=4, A=?"), { "a=3": false, "b=4": false, "A=?": true });
  const triangle = shapeLayout("right_triangle", { labels: "a=3, b=4, A=?" }, "t");
  assert.ok(triangle);
  // Legs 3 and 4 still set its proportions, as they do without the area label.
  const plain = shapeLayout("right_triangle", { labels: "a=3, b=4" }, "t");
  assert.ok(plain);
  assert.deepEqual(triangle.strokes, plain.strokes);
  assert.deepEqual(placed("rectangle", "l=8, w=3, A=?"), { "l=8": false, "w=3": false, "A=?": true });
  assert.deepEqual(placed("square", "s=4, P=?"), { "s=4": false, "P=?": true });
  assert.deepEqual(placed("triangle", "b=6, h=4, A=?"), { "b=6": false, "h=4": false, "A=?": true });
  // A label past the shape's last side isn't dropped: it goes under the shape too.
  const extra = shapeLayout("right_triangle", { labels: "3, 4, c=?, A=?" }, "t");
  assert.ok(extra);
  assert.deepEqual(
    extra.labels.map((label) => label.text),
    ["3", "4", "c=?", "A=?"],
  );
});

test("a rectangle takes its proportions from its labels", () => {
  const layout = shapeLayout("rectangle", { labels: "8 cm, 3 cm" }, "r");
  assert.ok(layout);
  const xs = layout.strokes[0].points.map((point) => point.x);
  const ys = layout.strokes[0].points.map((point) => point.y);
  assert.ok((Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys)) > 2.2);
  const [bottom, right] = layout.labels.map((label) => label.at);
  assert.ok(bottom.y > Math.max(...ys) && right.x > Math.max(...xs));
});

test("a triangle's height is drawn dashed with its own label", () => {
  const layout = shapeLayout("triangle", { labels: "b=6, h=4" }, "t");
  assert.ok(layout);
  const guides = layout.strokes.filter((stroke) => stroke.kind === "guide");
  assert.equal(guides.length, 1);
  const [top, foot] = [guides[0].points[0], guides[0].points[guides[0].points.length - 1]];
  assert.ok(Math.abs(top.x - foot.x) < 0.01 && foot.y > top.y);
  assert.deepEqual(
    layout.labels.map((label) => label.text),
    ["b=6", "h=4"],
  );
});

test("a circle draws its radius when one is labelled", () => {
  const radius = shapeLayout("circle", { labels: "r=5" }, "c");
  assert.ok(radius);
  assert.equal(radius.strokes.filter((stroke) => stroke.kind === "marker").length, 1);
  assert.equal(radius.labels[0].text, "r=5");
  const bare = shapeLayout("circle", {}, "c");
  assert.ok(bare && bare.strokes.every((stroke) => stroke.kind !== "marker") && !bare.labels.length);
});

test("fraction models divide into equal parts and shade from the first", () => {
  const bar = shapeLayout("fraction_bar", { parts: 4, shaded: 3 }, "f");
  assert.ok(bar);
  assert.equal(bar.strokes.filter((stroke) => stroke.kind === "divider").length, 3);
  const shades = bar.strokes.filter((stroke) => stroke.kind === "shade");
  assert.equal(shades.length, 3);
  // The shaded parts sit side by side from the left, each a quarter of the bar.
  const lefts = shades.map((stroke) => Math.min(...stroke.points.map((point) => point.x)));
  assert.deepEqual([...lefts].sort((a, b) => a - b), lefts);
  const widths = shades.map((stroke) => {
    const xs = stroke.points.map((point) => point.x);
    return Math.max(...xs) - Math.min(...xs);
  });
  assert.ok(widths.every((width) => Math.abs(width - widths[0]) < 0.01));

  const pie = shapeLayout("fraction_circle", { parts: 8, shaded: 3, labels: "3/8" }, "f");
  assert.ok(pie);
  assert.equal(pie.strokes.filter((stroke) => stroke.kind === "divider").length, 8);
  assert.equal(pie.strokes.filter((stroke) => stroke.kind === "shade").length, 3);
  assert.equal(pie.labels[0].text, "3/8");
  // Parts and shading are kept to what can be drawn.
  const capped = shapeLayout("fraction_bar", { parts: 40, shaded: 99 }, "f");
  assert.ok(capped);
  assert.equal(capped.strokes.filter((stroke) => stroke.kind === "shade").length, 12);
  const none = shapeLayout("fraction_circle", { parts: Number.NaN }, "f");
  assert.ok(none && none.strokes.filter((stroke) => stroke.kind === "shade").length === 0);
});

// Marks for mark_work and ends for draw_line.

const inside = (points: { x: number; y: number }[], area: { x: number; y: number; w: number; h: number }, slack = 3) =>
  points.every(
    (point) =>
      point.x >= area.x - slack && point.x <= area.x + area.w + slack && point.y >= area.y - slack && point.y <= area.y + area.h + slack,
  );

test("a check mark is one stroke down then up to the right, inside its box", () => {
  const area = { x: 500, y: 300, w: 40, h: 40 };
  const strokes = markStrokes("correct", area, "p1.q3:1");
  assert.deepEqual(strokes, markStrokes("correct", area, "p1.q3:1"));
  assert.equal(strokes.length, 1);
  const [{ kind, points }] = strokes;
  assert.equal(kind, "line");
  assert.ok(inside(points, area));
  const first = points[0];
  const last = points[points.length - 1];
  const lowest = points.reduce((low, point) => (point.y > low.y ? point : low));
  // Down to the bottom, left of centre, then up past the start to the upper right.
  assert.ok(lowest.y > first.y && lowest.x < area.x + area.w / 2);
  assert.ok(last.x > lowest.x && last.y < first.y);
  // Points close together, so tldraw draws it evenly.
  assert.ok(points.every((point, index) => !index || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) <= 6));
});

test("a cross is two crossing strokes, and a question mark a hook and a dot", () => {
  const area = { x: 0, y: 0, w: 40, h: 40 };
  const cross = markStrokes("incorrect", area, "s1");
  assert.equal(cross.length, 2);
  assert.ok(cross.every((stroke) => stroke.kind === "line" && inside(stroke.points, area)));
  // One runs down to the right, the other down to the left.
  const slope = (points: { x: number; y: number }[]) => Math.sign(points[points.length - 1].x - points[0].x);
  assert.deepEqual(cross.map((stroke) => slope(stroke.points)), [1, -1]);

  const question = markStrokes("check_again", area, "q1");
  assert.deepEqual(question.map((stroke) => stroke.kind), ["line", "dot"]);
  assert.ok(question.every((stroke) => inside(stroke.points, area)));
  const [hook, dot] = question;
  // The dot sits below the hook.
  assert.ok(Math.min(...dot.points.map((point) => point.y)) > Math.max(...hook.points.map((point) => point.y)));
  assert.deepEqual(markStrokes("nonsense" as never, area, "q1"), []);
  assert.deepEqual([...MARK_VERDICTS], ["correct", "incorrect", "check_again"]);
});

test("a mark sits just right of the work, level with a short piece and at the foot of a tall one", () => {
  const short = markBox({ x: 100, y: 200, w: 300, h: 40 });
  assert.ok(short.x > 400 && short.x < 430);
  assert.ok(Math.abs(short.y + short.h / 2 - 220) < 1);
  assert.ok(short.w >= 28 && short.w <= 44 && short.w === short.h);
  const tall = markBox({ x: 100, y: 200, w: 300, h: 400 });
  assert.equal(tall.y + tall.h, 600);
  assert.equal(tall.w, 44);
  // A tap-sized spot still gets a readable mark.
  assert.equal(markBox({ x: 0, y: 0, w: 10, h: 10 }).w, 28);
});

test("a line joins the nearest edges of two boxes, short of each", () => {
  const left = { x: 0, y: 0, w: 100, h: 50 };
  const right = { x: 300, y: 0, w: 100, h: 50 };
  const across = lineEnds(left, right);
  assert.deepEqual(across.start, { x: 108, y: 25 });
  assert.deepEqual(across.end, { x: 292, y: 25 });
  // Stacked boxes join bottom to top, through the gap between them.
  const below = { x: 0, y: 200, w: 100, h: 50 };
  const down = lineEnds(left, below);
  assert.deepEqual([down.start.y, down.end.y], [58, 192]);
  assert.deepEqual([down.start.x, down.end.x], [50, 50]);
  // Overlapping boxes still get a line between their centres.
  const overlap = lineEnds(left, { x: 20, y: 10, w: 100, h: 50 });
  assert.ok(Number.isFinite(overlap.start.x) && Number.isFinite(overlap.end.x));
});

test("each mark's stroke kinds are known before it's placed", () => {
  for (const verdict of MARK_VERDICTS) {
    const strokes = markStrokes(verdict, { x: 10, y: 10, w: 40, h: 40 }, "p1.q1");
    assert.deepEqual(
      strokes.map((stroke) => stroke.kind),
      MARK_STROKE_KINDS[verdict],
    );
  }
  assert.ok(isMarkVerdict("check_again"));
  assert.ok(!isMarkVerdict("maybe") && !isMarkVerdict(undefined));
});

test("a work check's result picks its mark, and blank or unreadable work gets none", () => {
  assert.equal(markVerdictFor("correct"), "correct");
  assert.equal(markVerdictFor("error"), "incorrect");
  assert.equal(markVerdictFor("incomplete"), "check_again");
  assert.equal(markVerdictFor("blank"), undefined);
  assert.equal(markVerdictFor("unreadable"), undefined);
  assert.equal(markVerdictFor("constructor"), undefined);
});
