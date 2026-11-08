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
