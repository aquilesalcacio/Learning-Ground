// Hand-drawn geometry for the tutor's marks, in board units. The pen (lg-tutor-pen.ts) traces
// these points over time, so a mark is drawn the way a hand would draw it.
// No tldraw imports, so `node --test` runs it without a bundler.

export type InkPoint = { x: number; y: number };
export type InkBounds = { x: number; y: number; w: number; h: number };

// Points along a stroke sit about this far apart, which keeps tldraw's Float16 deltas precise.
const STEP = 5;
const CIRCLE_PADDING = 12;

// Deterministic randomness from a string (FNV-1a into mulberry32), so a mark drawn for the same
// region keeps its shape, and tests can check exact values.
export function inkRandom(seed: string): () => number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Padding that lets an oval enclose a rectangle's corners, so its label isn't cut through.
export function ovalPadding(w: number, h: number): { x: number; y: number } {
  const short = Math.min(w, h);
  const radius = short / 2 + CIRCLE_PADDING;
  const along = radius - Math.sqrt(radius * radius - (short / 2) ** 2);
  return w >= h ? { x: along, y: CIRCLE_PADDING } : { x: CIRCLE_PADDING, y: along };
}

// A loop around a box, as a hand draws it: it starts at the upper left, runs clockwise a little
// more than once round, and wobbles and widens slightly, so the end overshoots the start.
export function loopPoints(bounds: InkBounds, seed: string): InkPoint[] {
  const random = inkRandom(`loop:${seed}`);
  const padding = ovalPadding(bounds.w, bounds.h);
  const rx = bounds.w / 2 + padding.x;
  const ry = bounds.h / 2 + padding.y;
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  const start = -Math.PI * 0.75 + (random() - 0.5) * 0.3;
  const sweep = Math.PI * 2 * (1.06 + random() * 0.05);
  const tilt = (random() - 0.5) * 0.06;
  const phase2 = random() * Math.PI * 2;
  const phase3 = random() * Math.PI * 2;
  // Ramanujan's approximation of the ellipse's perimeter, for the point spacing.
  const perimeter = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  const count = Math.min(400, Math.max(24, Math.ceil((perimeter * (sweep / (Math.PI * 2))) / STEP)));
  const points: InkPoint[] = [];
  for (let index = 0; index <= count; index += 1) {
    const along = index / count;
    const angle = start + sweep * along;
    const wobble = 1 + 0.022 * Math.sin(angle * 2 + phase2) + 0.012 * Math.sin(angle * 3 + phase3) + 0.035 * along;
    const x = Math.cos(angle) * rx * wobble;
    const y = Math.sin(angle) * ry * wobble;
    points.push({
      x: cx + x * Math.cos(tilt) - y * Math.sin(tilt),
      y: cy + x * Math.sin(tilt) + y * Math.cos(tilt),
    });
  }
  return points;
}

// A slightly bowed line under a box, a little in from both ends.
export function underlinePoints(bounds: InkBounds, seed: string): InkPoint[] {
  const random = inkRandom(`underline:${seed}`);
  const inset = Math.min(bounds.w * 0.02, 12);
  const left = bounds.x + inset + (random() - 0.5) * 4;
  const right = bounds.x + bounds.w - inset + (random() - 0.5) * 4;
  const top = bounds.y + bounds.h + 6;
  const sag = 3 + random() * 3;
  const slope = (random() - 0.5) * 4;
  const count = Math.max(8, Math.ceil((right - left) / STEP));
  const points: InkPoint[] = [];
  for (let index = 0; index <= count; index += 1) {
    const along = index / count;
    points.push({ x: left + (right - left) * along, y: top + sag * Math.sin(Math.PI * along) + slope * along });
  }
  return points;
}

// A marker swipe across a box: one pass for a single line, or back and forth down a taller box,
// each pass overlapping the last so the whole problem is coloured in.
export function highlightPoints(bounds: InkBounds, seed: string, strokeWidth: number): InkPoint[] {
  const random = inkRandom(`highlight:${seed}`);
  const passes = Math.max(1, Math.min(12, Math.round(bounds.h / (strokeWidth * 0.8))));
  const top = bounds.y + Math.min(strokeWidth * 0.4, bounds.h / 2);
  const bottom = bounds.y + bounds.h - Math.min(strokeWidth * 0.4, bounds.h / 2);
  const left = bounds.x - 4;
  const right = bounds.x + bounds.w + 4;
  const points: InkPoint[] = [];
  for (let pass = 0; pass < passes; pass += 1) {
    const y = passes === 1 ? bounds.y + bounds.h / 2 : top + ((bottom - top) * pass) / (passes - 1);
    const drift = (random() - 0.5) * 3;
    const forward = pass % 2 === 0;
    const count = Math.max(6, Math.ceil((right - left) / (STEP + 1)));
    for (let index = 0; index <= count; index += 1) {
      const along = index / count;
      const x = forward ? left + (right - left) * along : right - (right - left) * along;
      points.push({ x, y: y + drift * along + Math.sin(along * Math.PI) * 1.5 });
    }
  }
  return points;
}

export function pathLength(points: InkPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return length;
}

// The first part of a stroke, a fraction t of its length, ending exactly where the pen is.
export function partialPath(points: InkPoint[], t: number): InkPoint[] {
  if (points.length < 2 || t >= 1) return points.slice();
  if (t <= 0) return points.slice(0, 1);
  const target = pathLength(points) * t;
  const out: InkPoint[] = [points[0]];
  let walked = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const piece = Math.hypot(to.x - from.x, to.y - from.y);
    if (walked + piece >= target) {
      const share = piece > 0 ? (target - walked) / piece : 0;
      out.push({ x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share });
      return out;
    }
    walked += piece;
    out.push(to);
  }
  return out;
}

export function lastPoint(points: InkPoint[]): InkPoint {
  return points[points.length - 1] ?? { x: 0, y: 0 };
}

// Where the arrow between two boxes starts and ends. It arcs out through the left gutter, and
// the bend is relative to travel, so it flips going up.
const ARROW_BEND = 40;

export function arrowEnds(from: InkBounds, to: InkBounds): { start: InkPoint; end: InkPoint; bend: number } {
  const start = { x: from.x, y: from.y + from.h / 2 };
  const end = { x: to.x, y: to.y + to.h / 2 };
  return { start, end, bend: end.y >= start.y ? ARROW_BEND : -ARROW_BEND };
}

// Where a plain line between two boxes starts and ends: on the straight run between their centres,
// just outside each box, so it joins their nearest edges. Boxes that touch or overlap are joined
// centre to centre.
const LINE_GAP = 8;

export function lineEnds(from: InkBounds, to: InkBounds, gap = LINE_GAP): { start: InkPoint; end: InkPoint } {
  const a = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const b = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!length) return { start: a, end: b };
  // How far from its centre the run leaves a box, along the run.
  const exit = (box: InkBounds) =>
    Math.min(dx ? box.w / 2 / Math.abs(dx) : Infinity, dy ? box.h / 2 / Math.abs(dy) : Infinity) * length;
  const startAt = exit(from) + gap;
  const endAt = length - exit(to) - gap;
  if (startAt >= endAt) return { start: a, end: b };
  const round = (value: number) => Math.round(value * 100) / 100;
  const along = (distance: number) => ({ x: round(a.x + (dx / length) * distance), y: round(a.y + (dy / length) * distance) });
  return { start: along(startAt), end: along(endAt) };
}

// Signed distance of a curve's middle from its chord, the way tldraw reads an arrow's bend.
function bendOf(start: InkPoint, end: InkPoint, middle: InkPoint): number {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (!length) return 0;
  const normal = { x: -(end.y - start.y) / length, y: (end.x - start.x) / length };
  return (middle.x - (start.x + end.x) / 2) * normal.x + (middle.y - (start.y + end.y) / 2) * normal.y;
}

// A share t of the curved arrow from start to end: where its tip is, and the bend that keeps the
// shorter arrow on the same curve. So the arrow grows along its final arc instead of uncurling.
export function arcAt(start: InkPoint, end: InkPoint, bend: number, t: number): { point: InkPoint; bend: number } {
  const chord = Math.hypot(end.x - start.x, end.y - start.y);
  if (t >= 1) return { point: end, bend };
  if (Math.abs(bend) < 0.5 || !chord) {
    return { point: { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }, bend: 0 };
  }
  const normal = { x: -(end.y - start.y) / chord, y: (end.x - start.x) / chord };
  const half = chord / 2;
  const radius = (half * half + bend * bend) / (2 * Math.abs(bend));
  const offset = bend - Math.sign(bend) * radius;
  const center = { x: (start.x + end.x) / 2 + normal.x * offset, y: (start.y + end.y) / 2 + normal.y * offset };
  const angleOf = (point: InkPoint) => Math.atan2(point.y - center.y, point.x - center.x);
  const middle = { x: (start.x + end.x) / 2 + normal.x * bend, y: (start.y + end.y) / 2 + normal.y * bend };
  const from = angleOf(start);
  // The sweep from start to end that passes through the middle.
  let sweep = angleOf(end) - from;
  let toMiddle = angleOf(middle) - from;
  const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
  sweep = wrap(sweep);
  toMiddle = wrap(toMiddle);
  if (Math.sign(toMiddle) !== Math.sign(sweep) || Math.abs(toMiddle) > Math.abs(sweep)) {
    sweep = sweep > 0 ? sweep - Math.PI * 2 : sweep + Math.PI * 2;
  }
  const at = (share: number) => ({
    x: center.x + radius * Math.cos(from + sweep * share),
    y: center.y + radius * Math.sin(from + sweep * share),
  });
  const point = at(t);
  return { point, bend: bendOf(start, point, at(t / 2)) };
}

// A number line in the margin: the axis, ticks at a round step, and the tutor's marked values.
export type NumberLineMark = { value: number; label?: string };
export type NumberLineLayout = {
  axis: [InkPoint, InkPoint];
  ticks: { x: number; label: string }[];
  dots: { x: number; label: string }[];
  // The axis's height on the board, from its top-left corner, with room for labels above and below.
  y: number;
  height: number;
};

export const NUMBER_LINE_MAX_MARKS = 6;
const MAX_TICKS = 10;

// The smallest of 1, 2 or 5 times a power of ten that keeps the tick count at MAX_TICKS or fewer.
export function niceStep(span: number): number {
  const rough = span / MAX_TICKS;
  const power = 10 ** Math.floor(Math.log10(rough));
  for (const factor of [1, 2, 5, 10]) {
    if (factor * power >= rough) return factor * power;
  }
  return 10 * power;
}

export function formatNumber(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

// "3/4", "-1.5" or "2" as a number. NaN when it isn't one.
export function parseNumber(text: string): number {
  const clean = String(text ?? "").trim().replace(/\u2212/g, "-");
  const fraction = clean.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  return clean ? Number(clean) : Number.NaN;
}

// The tutor's marks for a number line, written "value:label" and separated by commas, such as
// "1/2, 0.75:three quarters". A value written as a fraction keeps the fraction as its label.
export function parseNumberLineMarks(text: string): NumberLineMark[] {
  return String(text ?? "")
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [raw, ...rest] = part.split(":");
      const label = rest.join(":").trim() || (raw.includes("/") ? raw.trim() : "");
      return { value: parseNumber(raw), ...(label ? { label: label.slice(0, 16) } : {}) };
    })
    .filter((mark) => Number.isFinite(mark.value))
    .slice(0, NUMBER_LINE_MAX_MARKS);
}

// Null when the range can't be drawn: not numbers, or max not above min.
export function numberLineLayout(
  origin: InkPoint,
  width: number,
  min: number,
  max: number,
  marks: NumberLineMark[] = [],
): NumberLineLayout | null {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min || width <= 0) return null;
  const span = max - min;
  const left = origin.x + 12;
  const right = origin.x + width - 12;
  const y = origin.y + 30;
  const at = (value: number) => left + ((value - min) / span) * (right - left);
  const step = niceStep(span);
  const ticks: { x: number; label: string }[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-9; value += step) {
    ticks.push({ x: at(value), label: formatNumber(value) });
  }
  const dots = marks
    .filter((mark) => Number.isFinite(mark.value) && mark.value >= min && mark.value <= max)
    .slice(0, NUMBER_LINE_MAX_MARKS)
    .map((mark) => ({ x: at(mark.value), label: (mark.label ?? "").trim() || formatNumber(mark.value) }));
  return { axis: [{ x: left - 8, y }, { x: right + 8, y }], ticks, dots, y, height: 64 };
}

// Extra points along straight runs. tldraw draws a stroke thinner where its points are far
// apart, so evenly spaced points keep the line even.
export function densify(points: InkPoint[], step = STEP): InkPoint[] {
  const out: InkPoint[] = points.slice(0, 1);
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const pieces = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / step));
    for (let piece = 1; piece <= pieces; piece += 1) {
      out.push({ x: from.x + ((to.x - from.x) * piece) / pieces, y: from.y + ((to.y - from.y) * piece) / pieces });
    }
  }
  return out;
}

// The number line's axis as one stroke, left to right: an arrowhead, a tick at each step drawn
// up and back down, and an arrowhead at the right end.
export function numberLineStroke(layout: NumberLineLayout): InkPoint[] {
  const [left, right] = layout.axis;
  const y = left.y;
  const points: InkPoint[] = [
    { x: left.x + 8, y: y - 6 },
    { x: left.x, y },
    { x: left.x + 8, y: y + 6 },
    { x: left.x, y },
  ];
  for (const tick of layout.ticks) {
    points.push({ x: tick.x, y }, { x: tick.x, y: y - 7 }, { x: tick.x, y: y + 7 }, { x: tick.x, y });
  }
  points.push({ x: right.x, y }, { x: right.x - 8, y: y - 6 }, { x: right.x, y }, { x: right.x - 8, y: y + 6 });
  return densify(points, 3);
}

// A rounded box traced clockwise from its top-left corner, closed back where it started.
export function roundedRectPoints(bounds: InkBounds, radius = 12): InkPoint[] {
  const r = Math.max(0, Math.min(radius, bounds.w / 2, bounds.h / 2));
  const { x, y, w, h } = bounds;
  const corner = (cx: number, cy: number, from: number): InkPoint[] =>
    Array.from({ length: 5 }, (_, index) => {
      const angle = from + (index / 4) * (Math.PI / 2);
      return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
    });
  const outline: InkPoint[] = [
    ...corner(x + w - r, y + r, -Math.PI / 2),
    ...corner(x + w - r, y + h - r, 0),
    ...corner(x + r, y + h - r, Math.PI / 2),
    ...corner(x + r, y + r, Math.PI),
  ];
  return densify([{ x: x + r, y }, ...outline, { x: x + r, y }], STEP);
}

// A small closed loop for a dot. Drawn with a solid fill, it reads as a pen dot.
export function dotPoints(center: InkPoint, radius = 5): InkPoint[] {
  return Array.from({ length: 17 }, (_, index) => {
    const angle = (index / 16) * Math.PI * 2;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
}

// Which ticks get a number under them: all of them when they fit, else every other one.
export function labelledTicks(layout: NumberLineLayout): NumberLineLayout["ticks"] {
  if (layout.ticks.length <= 6) return layout.ticks;
  return layout.ticks.filter((_, index) => index % 2 === 0);
}

// The first share t of a text, by character, so emoji and accents are never split.
export function typedText(text: string, t: number): string {
  const characters = Array.from(text);
  return characters.slice(0, Math.round(characters.length * Math.min(Math.max(t, 0), 1))).join("");
}

export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
// Overshoots a little and settles back, for a springy arrival.
export const easeOutBack = (t: number) => {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
// A hand speeds up into a stroke and slows at its end, but less than a full ease in and out.
export const easeStroke = (t: number) => 0.25 * t + 0.75 * easeInOutCubic(t);

// A graph axis as one stroke, from its start to the arrowhead at its end, with a short tick
// across it at each mark, drawn out to one side and back through the axis, as a hand does.
export function axisStroke(from: InkPoint, to: InkPoint, ticks: InkPoint[]): InkPoint[] {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const along = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
  const across = { x: -along.y, y: along.x };
  const at = (base: InkPoint, back: number, side: number) => ({
    x: base.x - along.x * back + across.x * side,
    y: base.y - along.y * back + across.y * side,
  });
  const ordered = ticks
    .map((tick) => ({ tick, share: (tick.x - from.x) * along.x + (tick.y - from.y) * along.y }))
    .sort((a, b) => a.share - b.share)
    .map(({ tick }) => tick);
  const points: InkPoint[] = [from];
  for (const tick of ordered) points.push(tick, at(tick, 0, 5), at(tick, 0, -5), tick);
  points.push(to, at(to, 8, 5), to, at(to, 8, -5));
  return densify(points, 3);
}

// Shapes for the draw_shape tool. Outlines wobble a little, seeded like the other marks, so the
// same shape on the same target keeps its look.

// A closed outline through the corners, each side bowed a touch, ending a little past where it
// started, the way a hand closes a shape.
export function polygonPoints(corners: InkPoint[], seed: string): InkPoint[] {
  const random = inkRandom(`polygon:${seed}`);
  const placed = corners.map((corner) => ({ x: corner.x + (random() - 0.5) * 2, y: corner.y + (random() - 0.5) * 2 }));
  const points: InkPoint[] = [];
  placed.forEach((from, index) => {
    const to = placed[(index + 1) % placed.length];
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const normal = { x: -(to.y - from.y) / length, y: (to.x - from.x) / length };
    const bow = (random() - 0.5) * 3;
    const count = Math.max(2, Math.ceil(length / STEP));
    for (let step = 0; step < count; step += 1) {
      const t = step / count;
      const sag = bow * Math.sin(Math.PI * t);
      points.push({ x: from.x + (to.x - from.x) * t + normal.x * sag, y: from.y + (to.y - from.y) * t + normal.y * sag });
    }
  });
  const [first, second] = placed;
  const length = Math.hypot(second.x - first.x, second.y - first.y) || 1;
  points.push(first, { x: first.x + ((second.x - first.x) / length) * 3, y: first.y + ((second.y - first.y) / length) * 3 });
  return points;
}

// A circle drawn freehand: from the upper left, a little more than once round, its radius
// wavering by about one percent.
export function circlePoints(center: InkPoint, radius: number, seed: string): InkPoint[] {
  const random = inkRandom(`circle:${seed}`);
  const start = -Math.PI * 0.7 + (random() - 0.5) * 0.3;
  const sweep = Math.PI * 2 * (1.03 + random() * 0.02);
  const phase = random() * Math.PI * 2;
  const count = Math.max(24, Math.ceil((radius * sweep) / STEP));
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = start + (sweep * index) / count;
    const r = radius * (1 + 0.01 * Math.sin(angle * 2 + phase));
    return { x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r };
  });
}

// A closed slice of a circle, from the centre out along one edge, round the arc and back in.
// Angles are in radians, clockwise on the board from the right.
export function wedgePoints(center: InkPoint, radius: number, from: number, to: number): InkPoint[] {
  const count = Math.max(2, Math.ceil((radius * Math.abs(to - from)) / STEP));
  const arc = Array.from({ length: count + 1 }, (_, index) => {
    const angle = from + ((to - from) * index) / count;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
  return densify([center, ...arc, center]);
}

// The small square that marks a right angle, from one side to the other. along and across are
// unit directions from the corner along its two sides.
export function rightAnglePoints(corner: InkPoint, along: InkPoint, across: InkPoint, size: number): InkPoint[] {
  const a = { x: corner.x + along.x * size, y: corner.y + along.y * size };
  const b = { x: a.x + across.x * size, y: a.y + across.y * size };
  const c = { x: corner.x + across.x * size, y: corner.y + across.y * size };
  return densify([a, b, c], 2);
}

export const SHAPE_KINDS = ["rectangle", "square", "triangle", "right_triangle", "circle", "fraction_bar", "fraction_circle"] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

// whole: the label is about the whole shape, such as A=? for its area or P=? for its perimeter,
// so it goes under the shape instead of on a side.
export type ShapeLabel = { text: string; key: string; value: number; whole: boolean };
const SHAPE_LABELS_MAX = 4;
const SHAPE_LABEL_MAX = 14;

// The tutor's labels, separated by commas: "a=3, b=4, c=?", "r=5" or "8 cm". Each keeps its
// text as written, the name before an "=" in lower case, and its number, NaN for "?". A capital
// A or P, "area" or "perimeter" names the whole shape, while a small a is a side.
export function parseShapeLabels(text: string): ShapeLabel[] {
  return String(text ?? "")
    .split(/[,;]/)
    .map((part) => part.trim().slice(0, SHAPE_LABEL_MAX).trim())
    .filter(Boolean)
    .slice(0, SHAPE_LABELS_MAX)
    .map((part) => {
      const named = part.match(/^([a-zA-Z]{1,9})\s*=\s*(.*)$/);
      const rest = named ? named[2] : part;
      const number = rest.match(/^-?\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?/);
      const key = named ? named[1].toLowerCase() : "";
      const whole = !!named && (named[1] === "A" || named[1] === "P" || key === "area" || key === "perimeter");
      return { text: part, key, value: number ? parseNumber(number[0]) : Number.NaN, whole };
    });
}

export type ShapeStroke = {
  // outline: the shape itself. divider: a fraction's part lines. shade: a closed, filled part.
  // marker: a right angle, a radius or a diameter. dot: the centre of a circle. guide: a dashed height.
  kind: "outline" | "divider" | "shade" | "marker" | "dot" | "guide";
  points: InkPoint[];
};
// Each label by its centre.
export type ShapeLayout = { box: InkBounds; strokes: ShapeStroke[]; labels: { at: InkPoint; text: string }[] };
export type ShapeOptions = { labels?: string; parts?: number; shaded?: number };

// The board's handwriting: size "s" in tldraw's draw font.
const LABEL_CHAR_WIDTH = 9.5;
const LABEL_HALF_HEIGHT = 12;
export const SHAPE_W = 280;
const PARTS_MAX = 12;

const labelHalfWidth = (text: string) => (Array.from(text).length * LABEL_CHAR_WIDTH) / 2 + 4;

// Where a side's label goes: just outside its middle, far enough that the text clears the line.
function sideLabel(from: InkPoint, to: InkPoint, inside: InkPoint, text: string): { at: InkPoint; text: string } {
  const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  let normal = { x: -(to.y - from.y) / length, y: (to.x - from.x) / length };
  if ((inside.x - middle.x) * normal.x + (inside.y - middle.y) * normal.y > 0) normal = { x: -normal.x, y: -normal.y };
  const offset = 6 + Math.abs(normal.x) * labelHalfWidth(text) + Math.abs(normal.y) * LABEL_HALF_HEIGHT;
  return { at: { x: middle.x + normal.x * offset, y: middle.y + normal.y * offset }, text };
}

// Width over height from two labelled lengths, within limits, or the fallback.
function proportion(width: number, height: number, fallback: number, min: number, max: number): number {
  return width > 0 && height > 0 ? Math.min(max, Math.max(min, width / height)) : fallback;
}

// The largest box of this proportion that fits the limits.
function fit(aspect: number, maxW: number, maxH: number): { w: number; h: number } {
  return aspect * maxH > maxW ? { w: maxW, h: maxW / aspect } : { w: maxH * aspect, h: maxH };
}

// Labels that belong to no side, written on one line centred below the shape, from y down.
// Returns where the line ends, which is y when there's nothing to write.
function labelsBelow(labels: ShapeLabel[], centerX: number, y: number, texts: { at: InkPoint; text: string }[]): number {
  if (!labels.length) return y;
  texts.push({ at: { x: centerX, y: y + LABEL_HALF_HEIGHT }, text: labels.map((label) => label.text).join("  ") });
  return y + LABEL_HALF_HEIGHT * 2;
}

// The labels for a polygon's sides, in order, and the rest, which go under it: what's about the
// whole shape, such as A=?, and any beyond its number of sides.
function sideLabels(labels: ShapeLabel[], count: number): { sides: ShapeLabel[]; rest: ShapeLabel[] } {
  const sides = labels.filter((label) => !label.whole).slice(0, count);
  return { sides, rest: labels.filter((label) => !sides.includes(label)) };
}

const countOf = (value: number | undefined, fallback: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(0, Math.round(value as number))) : fallback;

// A shape for the draw_shape tool, laid out from its box's top-left corner at (0, 0), or null
// for a shape it doesn't know. Strokes come in drawing order, outline first.
export function shapeLayout(kind: string, options: ShapeOptions, seed: string): ShapeLayout | null {
  const labels = parseShapeLabels(options.labels ?? "");
  const strokes: ShapeStroke[] = [];
  const texts: { at: InkPoint; text: string }[] = [];
  const top = 30;
  const finish = (bottom: number): ShapeLayout => ({ box: { x: 0, y: 0, w: SHAPE_W, h: Math.ceil(bottom) }, strokes, labels: texts });

  switch (kind) {
    case "rectangle":
    case "square": {
      const { sides: named, rest } = sideLabels(labels, 4);
      const size =
        kind === "square" ? { w: 120, h: 120 } : fit(proportion(named[0]?.value, named[1]?.value, 1.6, 0.6, 2.5), 180, 120);
      const x = (SHAPE_W - size.w) / 2;
      const corners = [
        { x, y: top },
        { x: x + size.w, y: top },
        { x: x + size.w, y: top + size.h },
        { x, y: top + size.h },
      ];
      const center = { x: x + size.w / 2, y: top + size.h / 2 };
      strokes.push({ kind: "outline", points: polygonPoints(corners, seed) });
      // Sides in order: the bottom, the right, the top, the left.
      const sides: [InkPoint, InkPoint][] = [
        [corners[3], corners[2]],
        [corners[1], corners[2]],
        [corners[0], corners[1]],
        [corners[0], corners[3]],
      ];
      named.forEach((label, index) => texts.push(sideLabel(sides[index][0], sides[index][1], center, label.text)));
      return finish(labelsBelow(rest, center.x, top + size.h + LABEL_HALF_HEIGHT * 2 + 10, texts));
    }
    case "right_triangle": {
      // a is the upright leg, b the bottom one, c the long side, so legs 3 and 4 draw 4 wide by 3 high.
      const { sides: named, rest } = sideLabels(labels, 3);
      const size = fit(proportion(named[1]?.value, named[0]?.value, 4 / 3, 0.5, 2.5), 190, 130);
      const x = (SHAPE_W - size.w) / 2;
      const upper = { x, y: top };
      const corner = { x, y: top + size.h };
      const far = { x: x + size.w, y: top + size.h };
      const center = { x: x + size.w / 3, y: top + (size.h * 2) / 3 };
      strokes.push({ kind: "outline", points: polygonPoints([upper, corner, far], seed) });
      strokes.push({ kind: "marker", points: rightAnglePoints(corner, { x: 0, y: -1 }, { x: 1, y: 0 }, Math.min(14, size.h / 4)) });
      const sides: [InkPoint, InkPoint][] = [
        [upper, corner],
        [corner, far],
        [far, upper],
      ];
      named.forEach((label, index) => texts.push(sideLabel(sides[index][0], sides[index][1], center, label.text)));
      return finish(labelsBelow(rest, SHAPE_W / 2, top + size.h + LABEL_HALF_HEIGHT * 2 + 10, texts));
    }
    case "triangle": {
      // An h= label is the height, drawn dashed from the top down to the base. The rest are the
      // sides in order: the base, the right side, the left side.
      const height = labels.find((label) => label.key === "h" && !label.whole);
      const { sides: named, rest } = sideLabels(
        labels.filter((label) => label !== height),
        3,
      );
      const size = fit(proportion(named[0]?.value, height?.value ?? Number.NaN, 1.5, 0.8, 3), 200, 140);
      const x = (SHAPE_W - size.w) / 2;
      const left = { x, y: top + size.h };
      const right = { x: x + size.w, y: top + size.h };
      const apex = { x: x + size.w * 0.38, y: top };
      const center = { x: (left.x + right.x + apex.x) / 3, y: (left.y + right.y + apex.y) / 3 };
      strokes.push({ kind: "outline", points: polygonPoints([left, right, apex], seed) });
      if (height) {
        const foot = { x: apex.x, y: left.y };
        strokes.push({ kind: "guide", points: densify([apex, foot]) });
        strokes.push({ kind: "marker", points: rightAnglePoints(foot, { x: 0, y: -1 }, { x: 1, y: 0 }, Math.min(12, size.h / 4)) });
      }
      const sides: [InkPoint, InkPoint][] = [
        [left, right],
        [right, apex],
        [apex, left],
      ];
      named.forEach((label, index) => texts.push(sideLabel(sides[index][0], sides[index][1], center, label.text)));
      if (height) {
        texts.push({ at: { x: apex.x + labelHalfWidth(height.text) + 4, y: top + size.h * 0.55 }, text: height.text });
      }
      return finish(labelsBelow(rest, (left.x + right.x) / 2, top + size.h + LABEL_HALF_HEIGHT * 2 + 10, texts));
    }
    case "circle": {
      // r= or a bare value is the radius, drawn from the centre to the right; d= is the diameter.
      // Other labels, such as A=?, go under the circle.
      const radius = 70;
      const center = { x: SHAPE_W / 2, y: 16 + radius };
      strokes.push({ kind: "outline", points: circlePoints(center, radius, seed) });
      strokes.push({ kind: "dot", points: dotPoints(center, 3) });
      const line = labels.find((label) => !label.whole && (label.key === "r" || label.key === "d" || label.key === ""));
      if (line) {
        const start = line.key === "d" ? { x: center.x - radius, y: center.y } : center;
        strokes.push({ kind: "marker", points: densify([start, { x: center.x + radius, y: center.y }]) });
        texts.push({ at: { x: center.x + radius / 2, y: center.y - LABEL_HALF_HEIGHT - 4 }, text: line.text });
      }
      const below = labels.filter((label) => label !== line);
      return finish(labelsBelow(below, center.x, center.y + radius + 8, texts) + 8);
    }
    case "fraction_bar": {
      const parts = countOf(options.parts, 4, PARTS_MAX) || 1;
      const shaded = countOf(options.shaded, 0, parts);
      const bar = { x: 20, y: 16, w: SHAPE_W - 40, h: 52 };
      const width = bar.w / parts;
      strokes.push({
        kind: "outline",
        points: polygonPoints(
          [
            { x: bar.x, y: bar.y },
            { x: bar.x + bar.w, y: bar.y },
            { x: bar.x + bar.w, y: bar.y + bar.h },
            { x: bar.x, y: bar.y + bar.h },
          ],
          seed,
        ),
      });
      for (let part = 1; part < parts; part += 1) {
        const x = bar.x + width * part;
        strokes.push({ kind: "divider", points: densify([{ x, y: bar.y }, { x, y: bar.y + bar.h }]) });
      }
      for (let part = 0; part < shaded; part += 1) {
        const x = bar.x + width * part;
        strokes.push({
          kind: "shade",
          points: densify([
            { x, y: bar.y },
            { x: x + width, y: bar.y },
            { x: x + width, y: bar.y + bar.h },
            { x, y: bar.y + bar.h },
            { x, y: bar.y },
          ]),
        });
      }
      return finish(labelsBelow(labels, SHAPE_W / 2, bar.y + bar.h + 8, texts) + 8);
    }
    case "fraction_circle": {
      const parts = countOf(options.parts, 4, PARTS_MAX) || 1;
      const shaded = countOf(options.shaded, 0, parts);
      const radius = 75;
      const center = { x: SHAPE_W / 2, y: 16 + radius };
      // Parts run clockwise from the top, like a clock.
      const angle = (part: number) => -Math.PI / 2 + (Math.PI * 2 * part) / parts;
      strokes.push({ kind: "outline", points: circlePoints(center, radius, seed) });
      if (parts > 1) {
        for (let part = 0; part < parts; part += 1) {
          const edge = { x: center.x + Math.cos(angle(part)) * radius, y: center.y + Math.sin(angle(part)) * radius };
          strokes.push({ kind: "divider", points: densify([center, edge]) });
        }
      }
      for (let part = 0; part < shaded; part += 1) {
        strokes.push({ kind: "shade", points: wedgePoints(center, radius, angle(part), angle(part + 1)) });
      }
      return finish(labelsBelow(labels, center.x, center.y + radius + 8, texts) + 8);
    }
    default:
      return null;
  }
}

// Marks for the mark_work tool: a check, a cross or a question mark, drawn by hand beside the
// student's work. Each stroke wobbles a little, seeded like the other marks.
export const MARK_VERDICTS = ["correct", "incorrect", "check_again"] as const;
export type MarkVerdict = (typeof MARK_VERDICTS)[number];
// line: a pen stroke. dot: a small closed loop, filled, as the dot of a question mark.
export type MarkStroke = { kind: "line" | "dot"; points: InkPoint[] };
// Each mark's strokes, in drawing order, known before the mark is placed.
export const MARK_STROKE_KINDS: Record<MarkVerdict, MarkStroke["kind"][]> = {
  correct: ["line"],
  incorrect: ["line", "line"],
  check_again: ["line", "dot"],
};

export const isMarkVerdict = (value: unknown): value is MarkVerdict => MARK_VERDICTS.includes(value as MarkVerdict);

// The mark for a work check's result: a check when it's right, a cross for a mistake, a question
// mark when it's unfinished. Nothing found or nothing readable gets no mark.
const CHECK_MARKS: Record<string, MarkVerdict> = { correct: "correct", error: "incorrect", incomplete: "check_again" };

export function markVerdictFor(status: string): MarkVerdict | undefined {
  return Object.hasOwn(CHECK_MARKS, status) ? CHECK_MARKS[status] : undefined;
}

const MARK_MIN = 28;
const MARK_MAX = 44;
const MARK_GAP = 14;

// The square a mark goes in: just right of the work, level with it when it's short, or at its
// foot when it's tall, where the last line, usually the answer, is.
export function markBox(beside: InkBounds): InkBounds {
  const size = Math.min(MARK_MAX, Math.max(MARK_MIN, beside.h * 0.8));
  const y = beside.h > size * 2 ? beside.y + beside.h - size : beside.y + beside.h / 2 - size / 2;
  return { x: beside.x + beside.w + MARK_GAP, y, w: size, h: size };
}

// A stroke through points given as shares of the box, each nudged a little, bowed slightly.
function markStroke(box: InkBounds, shares: [number, number][], random: () => number): InkPoint[] {
  const points = shares.map(([x, y]) => ({ x: box.x + box.w * x + (random() - 0.5) * 2, y: box.y + box.h * y + (random() - 0.5) * 2 }));
  const bowed: InkPoint[] = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const sag = (random() - 0.5) * 2.5;
    bowed.push({ x: (from.x + to.x) / 2 - ((to.y - from.y) / length) * sag, y: (from.y + to.y) / 2 + ((to.x - from.x) / length) * sag }, to);
  }
  return densify(bowed, 3);
}

// The strokes of a mark in its box, in drawing order, or none for a verdict it doesn't know.
export function markStrokes(verdict: MarkVerdict, box: InkBounds, seed: string): MarkStroke[] {
  const random = inkRandom(`mark:${verdict}:${seed}`);
  switch (verdict) {
    case "correct":
      // A short stroke down, then a long one up to the right.
      return [
        {
          kind: "line",
          points: markStroke(
            box,
            [
              [0.06, 0.55],
              [0.38, 0.9],
              [0.95, 0.07],
            ],
            random,
          ),
        },
      ];
    case "incorrect":
      return [
        {
          kind: "line",
          points: markStroke(
            box,
            [
              [0.1, 0.1],
              [0.9, 0.9],
            ],
            random,
          ),
        },
        {
          kind: "line",
          points: markStroke(
            box,
            [
              [0.9, 0.1],
              [0.12, 0.88],
            ],
            random,
          ),
        },
      ];
    case "check_again": {
      // The hook runs from the left, over the top and round to below the right, then down.
      const radius = Math.min(box.w, box.h) * 0.22;
      const center = { x: box.x + box.w / 2, y: box.y + box.h * 0.3 };
      const from = Math.PI * 1.05;
      const to = Math.PI * 2.4;
      const count = Math.max(8, Math.ceil((radius * (to - from)) / 3));
      const arc = Array.from({ length: count + 1 }, (_, index) => {
        const angle = from + ((to - from) * index) / count;
        return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
      });
      const stem = { x: box.x + box.w * 0.5 + (random() - 0.5) * 2, y: box.y + box.h * 0.66 };
      return [
        { kind: "line", points: densify([...arc, stem], 3) },
        { kind: "dot", points: dotPoints({ x: box.x + box.w * 0.5, y: box.y + box.h * 0.88 }, 2.5) },
      ];
    }
    default:
      return [];
  }
}
