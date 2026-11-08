// Graphs for the tutor's plot_graph tool: a safe parser for functions of x, sampling, and the
// graph's layout in board units. Text from the tutor is never run as code: a tokenizer and a
// precedence parser build a small syntax tree, which is then evaluated. No eval, no Function.
// No imports at all, so `node --test` runs it without a bundler.

export type PlotPoint = { x: number; y: number; label: string };
type Point = { x: number; y: number };
type Bounds = { x: number; y: number; w: number; h: number };

const FUNCTIONS = new Map<string, (value: number) => number>([
  ["sin", Math.sin],
  ["cos", Math.cos],
  ["tan", Math.tan],
  ["sqrt", Math.sqrt],
  ["abs", Math.abs],
  ["ln", Math.log],
  ["log", Math.log10],
  ["exp", Math.exp],
]);
const CONSTANTS = new Map<string, number>([
  ["pi", Math.PI],
  ["e", Math.E],
]);
// Longest first, so "exp" isn't read as e times "xp".
const WORDS = [...FUNCTIONS.keys(), ...CONSTANTS.keys(), "x"].sort((a, b) => b.length - a.length);

export type PlotNode =
  | { kind: "number"; value: number }
  | { kind: "x" }
  | { kind: "negate"; arg: PlotNode }
  | { kind: "binary"; op: "+" | "-" | "*" | "/" | "^"; left: PlotNode; right: PlotNode }
  | { kind: "call"; name: string; arg: PlotNode };

export type PlotParse = { ok: true; node: PlotNode } | { ok: false; error: string };

type Token =
  | { kind: "number"; value: number }
  | { kind: "word"; word: string }
  | { kind: "op"; op: "+" | "-" | "*" | "/" | "^" | "(" | ")" };

const FUNCTION_MAX = 120;
const DEPTH_MAX = 20;

class PlotError extends Error {}

// "−", "×", "·", "÷", "²" and "³" as a student or a model may type them.
function normalise(text: string): string {
  return text
    .replace(/\u2212/g, "-")
    .replace(/[\u00d7\u00b7]/g, "*")
    .replace(/\u00f7/g, "/")
    .replace(/\u00b2/g, "^2")
    .replace(/\u00b3/g, "^3");
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(text.slice(index));
    if (number) {
      index += number[0].length;
      // 1e3 could mean 1000 or 1·e·3, so scientific notation is refused rather than guessed.
      if (/^[eE][+-]?\d/.test(text.slice(index))) throw new PlotError(`Scientific notation isn't supported: ${number[0]}e…`);
      tokens.push({ kind: "number", value: Number(number[0]) });
      continue;
    }
    const letters = /^[a-zA-Z]+/.exec(text.slice(index));
    if (letters) {
      // A run of letters is split into known words, such as "pix" into pi and x.
      let run = letters[0].toLowerCase();
      while (run) {
        const word = WORDS.find((item) => run.startsWith(item));
        if (!word) throw new PlotError(`Unknown name "${letters[0]}"`);
        tokens.push({ kind: "word", word });
        run = run.slice(word.length);
      }
      index += letters[0].length;
      continue;
    }
    if ("+-*/^()".includes(char)) {
      tokens.push({ kind: "op", op: char as "+" });
      index += 1;
      continue;
    }
    throw new PlotError(`Unexpected "${char}"`);
  }
  return tokens;
}

// expr    := term (("+" | "-") term)*
// term    := unary (("*" | "/") unary | factor)*      a factor right after a term multiplies it
// unary   := ("-" | "+") unary | power
// power   := primary ("^" unary)?                      right to left: 2^3^2 is 2^9
// primary := number | x | pi | e | "(" expr ")" | name "(" expr ")" | name argument
// A function without brackets takes the factors after it, so sin 2x is sin(2x), and stops at
// the next function, so sin x cos x is sin(x)·cos(x).
function parseTokens(tokens: Token[]): PlotNode {
  let at = 0;
  let depth = 0;
  const peek = () => tokens[at];
  const isOp = (token: Token | undefined, op: string) => token?.kind === "op" && token.op === op;
  const deeper = () => {
    depth += 1;
    if (depth > DEPTH_MAX) throw new PlotError("Too many nested brackets");
  };
  // Whether a token can start a factor that multiplies the term before it. A number can't:
  // "x2" or "2 3" is more likely a typo than a product.
  const startsFactor = (token: Token | undefined) => token?.kind === "word" || isOp(token, "(");

  function expression(): PlotNode {
    let node = term();
    while (isOp(peek(), "+") || isOp(peek(), "-")) {
      const op = (tokens[at++] as { op: "+" | "-" }).op;
      node = { kind: "binary", op, left: node, right: term() };
    }
    return node;
  }

  function term(): PlotNode {
    let node = unary();
    for (;;) {
      if (isOp(peek(), "*") || isOp(peek(), "/")) {
        const op = (tokens[at++] as { op: "*" | "/" }).op;
        node = { kind: "binary", op, left: node, right: unary() };
      } else if (startsFactor(peek())) {
        node = { kind: "binary", op: "*", left: node, right: power() };
      } else {
        return node;
      }
    }
  }

  function unary(): PlotNode {
    if (isOp(peek(), "-")) {
      at += 1;
      deeper();
      const arg = unary();
      depth -= 1;
      return { kind: "negate", arg };
    }
    if (isOp(peek(), "+")) {
      at += 1;
      return unary();
    }
    return power();
  }

  function power(): PlotNode {
    const base = primary();
    if (!isOp(peek(), "^")) return base;
    at += 1;
    deeper();
    const exponent = unary();
    depth -= 1;
    return { kind: "binary", op: "^", left: base, right: exponent };
  }

  function bracketed(): PlotNode {
    at += 1;
    deeper();
    const inner = expression();
    depth -= 1;
    if (!isOp(peek(), ")")) throw new PlotError("A bracket isn't closed");
    at += 1;
    return inner;
  }

  // The argument of a function written without brackets: a factor, and any more after it.
  function argument(): PlotNode {
    if (isOp(peek(), "-")) {
      at += 1;
      return { kind: "negate", arg: argument() };
    }
    let node = power();
    while (startsFactor(peek()) && !(peek()?.kind === "word" && FUNCTIONS.has((peek() as { word: string }).word))) {
      node = { kind: "binary", op: "*", left: node, right: power() };
    }
    return node;
  }

  function primary(): PlotNode {
    const token = peek();
    if (!token) throw new PlotError("The function ends too soon");
    if (token.kind === "number") {
      at += 1;
      return { kind: "number", value: token.value };
    }
    if (isOp(token, "(")) return bracketed();
    if (token.kind === "word") {
      at += 1;
      if (token.word === "x") return { kind: "x" };
      const constant = CONSTANTS.get(token.word);
      if (constant !== undefined) return { kind: "number", value: constant };
      deeper();
      const arg = isOp(peek(), "(") ? bracketed() : argument();
      depth -= 1;
      return { kind: "call", name: token.word, arg };
    }
    throw new PlotError(`Unexpected "${token.op}"`);
  }

  const node = expression();
  if (at < tokens.length) {
    const extra = tokens[at];
    throw new PlotError(`Unexpected "${extra.kind === "op" ? extra.op : extra.kind === "word" ? extra.word : extra.value}"`);
  }
  return node;
}

// One function of x, such as "2x + 1", "y = x^2 - 3" or "f(x) = sin x".
export function parsePlotFunction(text: string): PlotParse {
  const source = normalise(String(text ?? ""))
    .replace(/^\s*(?:y|[a-z]\s*\(\s*x\s*\))\s*=/i, "")
    .trim();
  if (!source) return { ok: false, error: "The function is empty" };
  if (source.length > FUNCTION_MAX) return { ok: false, error: `The function is longer than ${FUNCTION_MAX} characters` };
  try {
    return { ok: true, node: parseTokens(tokenize(source)) };
  } catch (error) {
    if (error instanceof PlotError) return { ok: false, error: `${error.message} in "${source}"` };
    throw error;
  }
}

export function evaluatePlot(node: PlotNode, x: number): number {
  switch (node.kind) {
    case "number":
      return node.value;
    case "x":
      return x;
    case "negate":
      return -evaluatePlot(node.arg, x);
    case "call":
      return (FUNCTIONS.get(node.name) as (value: number) => number)(evaluatePlot(node.arg, x));
    case "binary": {
      const left = evaluatePlot(node.left, x);
      const right = evaluatePlot(node.right, x);
      if (node.op === "+") return left + right;
      if (node.op === "-") return left - right;
      if (node.op === "*") return left * right;
      if (node.op === "/") return left / right;
      return left ** right;
    }
  }
}

export type PlotFunction = { source: string; node: PlotNode };
const PLOT_FUNCTIONS_MAX = 3;

// Up to three functions, separated by semicolons. One that can't be read stops the graph.
export function parsePlotFunctions(text: string): { ok: true; functions: PlotFunction[] } | { ok: false; error: string } {
  const sources = String(text ?? "")
    .split(/[;\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, PLOT_FUNCTIONS_MAX);
  const functions: PlotFunction[] = [];
  for (const source of sources) {
    const parsed = parsePlotFunction(source);
    if (!parsed.ok) return parsed;
    functions.push({ source, node: parsed.node });
  }
  return { ok: true, functions };
}

// Copies of lg-ink.ts's parseNumber and formatNumber: a module run by node --test can't import
// another one's code.
function parseNumber(text: string): number {
  const clean = String(text ?? "").trim().replace(/\u2212/g, "-");
  const fraction = clean.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  return clean ? Number(clean) : Number.NaN;
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

const PLOT_POINTS_MAX = 6;

// Points to mark, "x,y" or "x,y:label", separated by semicolons, such as "2,5:vertex; 0,1".
export function parsePlotPoints(text: string): PlotPoint[] {
  return String(text ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const [raw, ...rest] = part.split(":");
      const coordinates = raw.replace(/[()]/g, "").split(",");
      if (coordinates.length !== 2) return [];
      const [x, y] = coordinates.map(parseNumber);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
      const label = rest.join(":").trim().slice(0, 16) || `(${formatNumber(x)}, ${formatNumber(y)})`;
      return [{ x, y, label }];
    })
    .slice(0, PLOT_POINTS_MAX);
}

const PLOT_SAMPLES = 200;
const RANGE_LIMIT = 1e6;
// A value this far outside the chord's ends, as a share of the y range, means the function
// isn't continuous there.
const JUMP_TOLERANCE = 0.05;

// Copy of lg-ink.ts's niceStep, with the tick count as a parameter: the smallest of 1, 2 or 5
// times a power of ten that keeps the ticks at maxTicks or fewer.
function niceStep(span: number, maxTicks: number): number {
  const rough = span / maxTicks;
  const power = 10 ** Math.floor(Math.log10(rough));
  for (const factor of [1, 2, 5, 10]) {
    if (factor * power >= rough) return factor * power;
  }
  return 10 * power;
}

const X_TICKS = 10;
const Y_TICKS = 8;

export type PlotTick = { value: number; labelled: boolean };

// Ticks at a round step. Numbered ticks are at least gap apart, in the axis's own units, so the
// numbers don't run into each other: every tick when there's room, else every 2nd, 5th or 10th,
// which keeps them on round numbers and zero among them.
export function plotTicks(min: number, max: number, maxTicks: number, gap: number): PlotTick[] {
  const step = niceStep(max - min, maxTicks);
  const ticks: PlotTick[] = [];
  for (let k = Math.ceil(min / step - 1e-9); k * step <= max + step * 1e-9; k += 1) {
    ticks.push({ value: Math.round(k * step * 1e9) / 1e9 + 0, labelled: true });
  }
  let every = 1;
  for (const factor of [1, 2, 5, 10, 20, 50, 100]) {
    every = factor;
    if (factor * step >= gap - step * 1e-9) break;
  }
  if (every > 1) {
    for (const tick of ticks) tick.labelled = Math.round(tick.value / step) % every === 0;
  }
  return ticks;
}

const sampleXs = (xMin: number, xMax: number, samples: number) =>
  Array.from({ length: samples }, (_, index) => xMin + ((xMax - xMin) * index) / (samples - 1));

// The y range when the tutor didn't give one: what the curves and points cover, without the
// far tails that an asymptote throws up, rounded out to whole ticks and down to the x axis
// when that's near. A bound the tutor gave is kept.
export function plotRange(
  functions: PlotFunction[],
  points: PlotPoint[],
  xMin: number,
  xMax: number,
  yMin?: number,
  yMax?: number,
): { yMin: number; yMax: number } {
  const givenMin = Number.isFinite(yMin) ? (yMin as number) : null;
  const givenMax = Number.isFinite(yMax) ? (yMax as number) : null;
  if (givenMin !== null && givenMax !== null) return { yMin: givenMin, yMax: givenMax };
  const xs = sampleXs(xMin, xMax, PLOT_SAMPLES);
  const values = [
    ...functions.flatMap((item) => xs.map((x) => evaluatePlot(item.node, x))),
    ...points.filter((point) => point.x >= xMin && point.x <= xMax).map((point) => point.y),
  ]
    .filter((value) => Number.isFinite(value) && Math.abs(value) <= RANGE_LIMIT)
    .sort((a, b) => a - b);
  let lo = -5;
  let hi = 5;
  if (values.length) {
    // Rounded, so the two tails trim the same number of samples and a symmetric curve gets a symmetric range.
    const quantile = (share: number) => values[Math.round(share * (values.length - 1))];
    const q05 = quantile(0.05);
    const q95 = quantile(0.95);
    const spread = q95 - q05;
    lo = Math.max(values[0], q05 - spread * 0.5);
    hi = Math.min(values[values.length - 1], q95 + spread * 0.5);
    // The points always fit, even past the trimmed tails.
    for (const point of points) {
      if (point.x >= xMin && point.x <= xMax && Math.abs(point.y) <= RANGE_LIMIT) {
        lo = Math.min(lo, point.y);
        hi = Math.max(hi, point.y);
      }
    }
    if (hi - lo < 1e-6) {
      lo -= 1;
      hi += 1;
    }
    if (lo > 0 && lo <= 2 * (hi - lo)) lo = 0;
    if (hi < 0 && -hi <= 2 * (hi - lo)) hi = 0;
    const step = niceStep(hi - lo, Y_TICKS);
    lo = Math.floor(lo / step + 1e-9) * step;
    hi = Math.ceil(hi / step - 1e-9) * step;
  }
  if (givenMin !== null) return { yMin: givenMin, yMax: hi > givenMin ? hi : givenMin + 10 };
  if (givenMax !== null) return { yMin: lo < givenMax ? lo : givenMax - 10, yMax: givenMax };
  return { yMin: lo, yMax: hi };
}

// The part of a segment between yMin and yMax, or null when none of it is.
function clipSegment(a: Point, b: Point, yMin: number, yMax: number): [Point, Point] | null {
  let from = 0;
  let to = 1;
  const dy = b.y - a.y;
  for (const [edge, inside] of [
    [yMin, (y: number) => y >= yMin],
    [yMax, (y: number) => y <= yMax],
  ] as const) {
    if (dy === 0) {
      if (!inside(a.y)) return null;
      continue;
    }
    const t = (edge - a.y) / dy;
    if (inside(a.y)) {
      if (!inside(b.y)) to = Math.min(to, t);
    } else if (inside(b.y)) {
      from = Math.max(from, t);
    } else {
      return null;
    }
  }
  if (from > to) return null;
  const at = (t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: t === 0 ? a.y : t === 1 ? b.y : a.y + dy * t });
  const start = at(from);
  const end = at(to);
  // Exactly on the edge, so a curve that leaves the range ends right at it.
  if (from > 0) start.y = a.y < yMin ? yMin : yMax;
  if (to < 1) end.y = b.y < yMin ? yMin : yMax;
  return [start, end];
}

// A curve, sampled about 200 times across the range, as the unbroken pieces to draw, in the
// graph's own units. It breaks where the function isn't defined, where it jumps by more than
// the whole range between two samples, and where the value halfway between them falls outside
// them, which is how an asymptote such as 1/x at 0 or tan x at π/2 shows up. Clipped to the
// y range, so a curve that leaves it stops at the edge.
export function curvePieces(node: PlotNode, xMin: number, xMax: number, yMin: number, yMax: number, samples = PLOT_SAMPLES): Point[][] {
  const span = yMax - yMin;
  const tolerance = span * JUMP_TOLERANCE;
  const xs = sampleXs(xMin, xMax, samples);
  const ys = xs.map((x) => evaluatePlot(node, x));
  const pieces: Point[][] = [];
  let piece: Point[] = [];
  const flush = () => {
    if (piece.length >= 2) pieces.push(piece);
    piece = [];
  };
  for (let index = 1; index < samples; index += 1) {
    const a = { x: xs[index - 1], y: ys[index - 1] };
    const b = { x: xs[index], y: ys[index] };
    if (!Number.isFinite(a.y) || !Number.isFinite(b.y) || Math.abs(b.y - a.y) > span) {
      flush();
      continue;
    }
    const middle = evaluatePlot(node, (a.x + b.x) / 2);
    if (!Number.isFinite(middle) || middle < Math.min(a.y, b.y) - tolerance || middle > Math.max(a.y, b.y) + tolerance) {
      flush();
      continue;
    }
    const clipped = clipSegment(a, b, yMin, yMax);
    if (!clipped) {
      flush();
      continue;
    }
    const [start, end] = clipped;
    const last = piece[piece.length - 1];
    if (!last || last.x !== start.x || last.y !== start.y) {
      flush();
      piece.push(start);
    }
    piece.push(end);
  }
  flush();
  return pieces;
}

// The graph on the board: about 280 by 220, which fits the margin beside a problem.
export const GRAPH_W = 280;
export const GRAPH_H = 220;
// Room inside the box on each side, and more on the sides the numbers go.
const EDGE = 12;
const Y_LABEL_ROOM = 40;
const X_LABEL_ROOM = 30;
const PIECES_MAX = 20;
// The board's handwriting: size "s" in tldraw's draw font, as in lg-actions.ts.
const CHAR_WIDTH = 9.5;
// The space between two numbers on the x axis, and one line between two on the y axis.
const X_LABEL_SPACE = 8;
const Y_LABEL_GAP = 22;
// How far a y number's box sits from the y axis.
export const Y_LABEL_OFFSET = 6;

// The width of the box a tick's number is written in, with room for tldraw's padding so it
// stays on one line.
export const tickLabelWidth = (label: string) => Array.from(label).length * CHAR_WIDTH + 12;

export type GraphSpec = {
  functions: string;
  x_min: number;
  x_max: number;
  y_min?: number;
  y_max?: number;
  points?: string;
};

export type GraphLayout = {
  box: Bounds;
  // Each axis from its start to the end its arrowhead is on: x left to right, y bottom to top.
  xAxis: [Point, Point];
  yAxis: [Point, Point];
  // Each tick's spot on its axis, and its number, or "" when it isn't numbered.
  xTicks: { at: Point; label: string }[];
  yTicks: { at: Point; label: string }[];
  // The side of its axis each axis's numbers go: outside the plot when the axis is on its edge,
  // so they don't sit over the curves.
  xLabelSide: "below" | "above";
  yLabelSide: "left" | "right";
  // For each function, its unbroken pieces, left to right.
  curves: Point[][][];
  points: { at: Point; label: string }[];
};

// The whole graph, laid out from the box's top-left corner at (0, 0). When the functions or the
// range can't be drawn, nothing is: the reason comes back instead, for the log. A note comes
// back when part of a curve is left out.
export function graphLayout(
  spec: GraphSpec,
): { ok: true; layout: GraphLayout; note?: string } | { ok: false; error: string } {
  const xMin = Number(spec.x_min);
  const xMax = Number(spec.x_max);
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMax <= xMin) return { ok: false, error: "x_max must be above x_min" };
  if (Math.abs(xMin) > RANGE_LIMIT || Math.abs(xMax) > RANGE_LIMIT) return { ok: false, error: "The x range is too large" };
  const parsed = parsePlotFunctions(spec.functions);
  if (!parsed.ok) return parsed;
  const points = parsePlotPoints(spec.points ?? "");
  if (!parsed.functions.length && !points.length) return { ok: false, error: "There's no function or point to draw" };
  const { yMin, yMax } = plotRange(parsed.functions, points, xMin, xMax, spec.y_min, spec.y_max);
  if (!(yMax > yMin) || Math.abs(yMin) > RANGE_LIMIT || Math.abs(yMax) > RANGE_LIMIT) {
    return { ok: false, error: "y_max must be above y_min" };
  }

  // Each axis sits at zero on the other, or along the nearer edge when zero is out of range.
  const xAxisAt = Math.min(Math.max(0, yMin), yMax);
  const yAxisAt = Math.min(Math.max(0, xMin), xMax);
  const crossAtOrigin = xAxisAt === 0 && yAxisAt === 0;
  // When the axis is on the top or right edge, its numbers go outside it.
  const xLabelSide = yMax <= 0 ? "above" : "below";
  const yLabelSide = xMax <= 0 ? "right" : "left";
  // Zero isn't numbered where the axes cross, since both lines run through it.
  const tickLabel = (tick: PlotTick) => (tick.labelled && !(crossAtOrigin && tick.value === 0) ? formatNumber(tick.value) : "");

  const top = xLabelSide === "above" ? X_LABEL_ROOM : EDGE;
  const bottom = GRAPH_H - (xLabelSide === "above" ? EDGE : X_LABEL_ROOM);
  const yTickValues = plotTicks(yMin, yMax, Y_TICKS, (Y_LABEL_GAP * (yMax - yMin)) / (bottom - top));
  const yLabels = yTickValues.map(tickLabel);
  // Wide enough for the widest y number, and half the widest x number at each end.
  const yRoom = Math.max(Y_LABEL_ROOM, Y_LABEL_OFFSET + 2 + Math.max(0, ...yLabels.filter(Boolean).map(tickLabelWidth)));
  const allX = plotTicks(xMin, xMax, X_TICKS, 0).map((tick) => formatNumber(tick.value));
  const widestX = Math.max(...allX.map((label) => Array.from(label).length * CHAR_WIDTH));
  const xEnd = Math.max(EDGE, Math.ceil((widestX + 12) / 2));
  const left = Math.max(xEnd, yLabelSide === "left" ? yRoom : 0);
  const right = GRAPH_W - Math.max(xEnd, yLabelSide === "right" ? yRoom : 0);

  const toBoard = (point: Point): Point => ({
    x: left + ((point.x - xMin) / (xMax - xMin)) * (right - left),
    y: bottom - ((point.y - yMin) / (yMax - yMin)) * (bottom - top),
  });
  const xAxis: [Point, Point] = [toBoard({ x: xMin, y: xAxisAt }), toBoard({ x: xMax, y: xAxisAt })];
  const yAxis: [Point, Point] = [toBoard({ x: yAxisAt, y: yMin }), toBoard({ x: yAxisAt, y: yMax })];
  // The arrowheads reach a little past the last tick.
  xAxis[1] = { x: xAxis[1].x + 6, y: xAxis[1].y };
  yAxis[1] = { x: yAxis[1].x, y: yAxis[1].y - 6 };
  const xGap = ((widestX + X_LABEL_SPACE) * (xMax - xMin)) / (right - left);
  const xTicks = plotTicks(xMin, xMax, X_TICKS, xGap).map((tick) => ({
    at: toBoard({ x: tick.value, y: xAxisAt }),
    label: tickLabel(tick),
  }));
  const yTicks = yTickValues.map((tick, index) => ({
    at: toBoard({ x: yAxisAt, y: tick.value }),
    label: yLabels[index],
  }));
  let cut = 0;
  const curves = parsed.functions.map((item) => {
    const pieces = curvePieces(item.node, xMin, xMax, yMin, yMax);
    cut += Math.max(0, pieces.length - PIECES_MAX);
    return pieces.slice(0, PIECES_MAX).map((piece) => piece.map(toBoard));
  });
  const shown = points
    .filter((point) => point.x >= xMin && point.x <= xMax && point.y >= yMin && point.y <= yMax)
    .map((point) => ({ at: toBoard(point), label: point.label }));
  return {
    ok: true,
    layout: {
      box: { x: 0, y: 0, w: GRAPH_W, h: GRAPH_H },
      xAxis,
      yAxis,
      xTicks,
      yTicks,
      xLabelSide,
      yLabelSide,
      curves,
      points: shown,
    },
    ...(cut ? { note: `${cut} more pieces of a curve were left out, past the first ${PIECES_MAX}` } : {}),
  };
}
