// Run from web/: node --test lib/lg-plot.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

// Node needs the extension and TypeScript rejects it in a static import, so it's loaded here.
const plot = (await import(`./lg-plot${".ts"}`)) as typeof import("./lg-plot");
const {
  curvePieces,
  evaluatePlot,
  GRAPH_H,
  GRAPH_W,
  graphLayout,
  parsePlotFunction,
  parsePlotFunctions,
  parsePlotPoints,
  plotRange,
  plotTicks,
  tickLabelWidth,
  Y_LABEL_OFFSET,
} = plot;

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

// The value of a function at x, or the parser's error.
function at(text: string, x: number): number | string {
  const parsed = parsePlotFunction(text);
  return parsed.ok ? evaluatePlot(parsed.node, x) : parsed.error;
}

test("operators keep their precedence", () => {
  assert.equal(at("1 + 2 * 3", 0), 7);
  assert.equal(at("(1 + 2) * 3", 0), 9);
  assert.equal(at("2 ^ 3 ^ 2", 0), 512);
  assert.equal(at("-x^2", 3), -9);
  assert.equal(at("2^-1", 0), 0.5);
  assert.equal(at("10 - 4 - 3", 0), 3);
  assert.equal(at("12 / 3 / 2", 0), 2);
  assert.equal(at("x - -1", 2), 3);
});

test("implicit multiplication reads as a student writes it", () => {
  assert.equal(at("2x", 4), 8);
  assert.equal(at("3(x+1)", 2), 9);
  assert.equal(at("x(x-1)", 3), 6);
  assert.equal(at("(x+1)(x-1)", 3), 8);
  assert.equal(at("2x^2", 3), 18);
  assert.equal(at("2pi", 0), 2 * Math.PI);
  assert.equal(at("1/2x", 4), 2);
  // A number right after another term is a typo, not a product.
  assert.equal(typeof at("x2", 1), "string");
  assert.equal(typeof at("2 3", 1), "string");
});

test("functions, constants and the y= prefix", () => {
  assert.ok(close(at("sin(pi/2)", 0) as number, 1));
  assert.ok(close(at("tan x", Math.PI / 4) as number, 1));
  assert.ok(close(at("sin 2x", Math.PI / 4) as number, 1));
  assert.ok(close(at("sin x cos x", Math.PI / 4) as number, 0.5));
  assert.ok(close(at("sin(x)^2 + cos(x)^2", 1.234) as number, 1));
  assert.equal(at("sqrt(x) + abs(-3)", 16), 7);
  assert.ok(close(at("ln(e)", 0) as number, 1));
  assert.ok(close(at("log(1000)", 0) as number, 3));
  assert.ok(close(at("exp(0)", 0) as number, 1));
  assert.equal(at("y = 2x + 1", 3), 7);
  assert.equal(at("f(x) = x^2 - 3", 2), 1);
  assert.equal(at("Y=\u22122x", 1), -2);
  assert.equal(at("x\u00b2 \u00d7 3", 2), 12);
});

test("2e is two times e, and scientific notation is an error", () => {
  assert.ok(close(at("2e", 0) as number, 2 * Math.E));
  assert.ok(close(at("2ex", 1) as number, 2 * Math.E));
  for (const text of ["1e3", "2e-3", "2.5E+1"]) {
    const parsed = parsePlotFunction(text);
    assert.equal(parsed.ok, false, `${text} parsed`);
  }
});

test("code and unknown names are rejected, never run", () => {
  const rejected = ["alert(1)", "x + y", "Math.sin(x)", "sinh(x)", "x; alert(1)", "constructor", "x =>", "[1]", "2 ** 3"];
  rejected.push("", "sin()", "(x", "x)");
  for (const text of rejected) {
    const parsed = parsePlotFunction(text);
    assert.equal(parsed.ok, false, `${JSON.stringify(text)} parsed`);
  }
  const unknown = parsePlotFunction("alert(1)");
  assert.ok(!unknown.ok && /alert/.test(unknown.error));
  // Too long or too deep is refused before it's parsed.
  assert.equal(parsePlotFunction("x+".repeat(100) + "x").ok, false);
  assert.equal(parsePlotFunction("(".repeat(30) + "x" + ")".repeat(30)).ok, false);
});

test("several functions are split on semicolons, three at most", () => {
  const parsed = parsePlotFunctions("2x+1; x^2-3");
  assert.ok(parsed.ok);
  assert.equal(parsed.functions.length, 2);
  assert.equal(evaluatePlot(parsed.functions[1].node, 2), 1);
  const many = parsePlotFunctions("x; 2x; 3x; 4x");
  assert.ok(many.ok && many.functions.length === 3);
  // One bad function stops the whole graph.
  assert.equal(parsePlotFunctions("x; alert(1)").ok, false);
  const blank = parsePlotFunctions("  ;  ");
  assert.ok(blank.ok && blank.functions.length === 0);
});

test("points are read as x,y with an optional label", () => {
  assert.deepEqual(parsePlotPoints("2,5:vertex; 0,1; (3, -1/2); nope; 4"), [
    { x: 2, y: 5, label: "vertex" },
    { x: 0, y: 1, label: "(0, 1)" },
    { x: 3, y: -0.5, label: "(3, -0.5)" },
  ]);
  assert.deepEqual(parsePlotPoints(""), []);
  assert.equal(parsePlotPoints(Array.from({ length: 10 }, (_, index) => `${index},0`).join(";")).length, 6);
});

test("curves break at asymptotes instead of drawing a line through them", () => {
  const reciprocal = parsePlotFunction("1/x");
  assert.ok(reciprocal.ok);
  for (const [yMin, yMax] of [
    [-10, 10],
    [-1000, 1000],
  ]) {
    const pieces = curvePieces(reciprocal.node, -5, 5, yMin, yMax);
    assert.equal(pieces.length, 2, `1/x in [${yMin}, ${yMax}] has ${pieces.length} pieces`);
    // No piece crosses x = 0.
    for (const piece of pieces) assert.ok(piece.every((point) => point.x < 0) || piece.every((point) => point.x > 0));
  }
  const tangent = parsePlotFunction("tan x");
  assert.ok(tangent.ok);
  for (const [yMin, yMax] of [
    [-5, 5],
    [-50, 50],
  ]) {
    const pieces = curvePieces(tangent.node, -2 * Math.PI, 2 * Math.PI, yMin, yMax);
    assert.equal(pieces.length, 5, `tan x in [${yMin}, ${yMax}] has ${pieces.length} pieces`);
    // tan rises along each branch, so a runaway line back down would show as a fall.
    for (const piece of pieces) {
      for (let index = 1; index < piece.length; index += 1) assert.ok(piece[index].y >= piece[index - 1].y - 1e-9);
      assert.ok(piece.every((point) => point.y >= yMin - 1e-9 && point.y <= yMax + 1e-9));
    }
  }
});

test("curves are clipped to the range and skip where they aren't defined", () => {
  const square = parsePlotFunction("x^2");
  assert.ok(square.ok);
  const [piece, ...rest] = curvePieces(square.node, -5, 5, 0, 4);
  assert.equal(rest.length, 0);
  // It leaves the top at x = -2 and x = 2, exactly on the edge.
  assert.ok(Math.abs(piece[0].x + 2) < 0.01 && close(piece[0].y, 4));
  assert.ok(Math.abs(piece[piece.length - 1].x - 2) < 0.01 && close(piece[piece.length - 1].y, 4));
  const root = parsePlotFunction("sqrt(x)");
  assert.ok(root.ok);
  const roots = curvePieces(root.node, -4, 4, -1, 3);
  assert.equal(roots.length, 1);
  assert.ok(roots[0].every((point) => point.x >= 0));
});

test("the y range fits the curves when it isn't given, and ignores asymptotes", () => {
  const parabola = parsePlotFunctions("x^2");
  assert.ok(parabola.ok);
  // Rounded out to whole ticks, and down to the x axis.
  assert.deepEqual(plotRange(parabola.functions, [], -3, 3), { yMin: 0, yMax: 10 });
  const reciprocal = parsePlotFunctions("1/x");
  assert.ok(reciprocal.ok);
  const range = plotRange(reciprocal.functions, [], -5, 5);
  assert.ok(range.yMin < -1 && range.yMin >= -10 && range.yMax > 1 && range.yMax <= 10, JSON.stringify(range));
  // A curve that's symmetric about the origin gets a symmetric range.
  assert.equal(range.yMin, -range.yMax);
  // A flat line gets room around it, with the x axis in view.
  const flat = parsePlotFunctions("3");
  assert.ok(flat.ok);
  const level = plotRange(flat.functions, [], -5, 5);
  assert.ok(level.yMin <= 0 && level.yMax > 3, JSON.stringify(level));
  // Points count too, and one given bound is kept.
  assert.ok(plotRange([], [{ x: 1, y: 40, label: "" }], -5, 5).yMax >= 40);
  assert.equal(plotRange(parabola.functions, [], -3, 3, -2).yMin, -2);
  assert.equal(plotRange(parabola.functions, [], -3, 3, undefined, 5).yMax, 5);
});

test("ticks fall on round numbers, ten or fewer", () => {
  assert.deepEqual(plotTicks(-5, 5, 10, 0).map((tick) => tick.value), [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]);
  // Crowded axes number every other tick, here when the numbers need 1.2 units each.
  assert.deepEqual(
    plotTicks(-5, 5, 10, 1.2)
      .filter((tick) => tick.labelled)
      .map((tick) => tick.value),
    [-4, -2, 0, 2, 4],
  );
  // Or every fifth, still on round numbers.
  assert.deepEqual(
    plotTicks(-5, 5, 10, 3)
      .filter((tick) => tick.labelled)
      .map((tick) => tick.value),
    [-5, 0, 5],
  );
  assert.deepEqual(plotTicks(0, 9, 8, 0).map((tick) => tick.value), [0, 2, 4, 6, 8]);
  // With room for them, every tick is numbered.
  assert.ok(plotTicks(-5, 5, 10, 1).every((tick) => tick.labelled));
  assert.deepEqual(plotTicks(-0.5, 0.5, 10, 0).map((tick) => tick.value), [-0.5, -0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4, 0.5]);
});

test("the numbers on the axes never run into each other or out of the box", () => {
  const specs = [
    { functions: "x", x_min: -0.7, x_max: 0.7 },
    { functions: "50x+200", x_min: 0, x_max: 7000 },
    { functions: "x^3", x_min: -10, x_max: 10 },
    { functions: "x", x_min: -5, x_max: 5 },
    { functions: "x^2", x_min: -1000000, x_max: 1000000 },
    { functions: "x - 3", x_min: -8, x_max: -2 },
    { functions: "-x^2 - 1", x_min: -3, x_max: 3 },
  ];
  for (const spec of specs) {
    const graph = graphLayout(spec);
    assert.ok(graph.ok, graph.ok ? "" : graph.error);
    const { layout } = graph;
    const name = `${spec.functions} on [${spec.x_min}, ${spec.x_max}]`;
    // Each x number is centred on its tick, so two neighbours need half of each width between them.
    const xs = layout.xTicks.filter((tick) => tick.label);
    for (let index = 1; index < xs.length; index += 1) {
      const room = (tickLabelWidth(xs[index - 1].label) + tickLabelWidth(xs[index].label)) / 2 - 12;
      assert.ok(xs[index].at.x - xs[index - 1].at.x >= room, `${name}: ${xs[index - 1].label} and ${xs[index].label} overlap`);
    }
    for (const tick of xs) {
      const half = tickLabelWidth(tick.label) / 2;
      assert.ok(tick.at.x - half >= -0.01 && tick.at.x + half <= GRAPH_W + 0.01, `${name}: ${tick.label} leaves the box`);
    }
    // Each y number fits between its axis and the edge of the box on its side, a line apart.
    const ys = layout.yTicks.filter((tick) => tick.label);
    for (const tick of ys) {
      const w = tickLabelWidth(tick.label);
      const fits =
        layout.yLabelSide === "left" ? tick.at.x - Y_LABEL_OFFSET - w >= -0.01 : tick.at.x + Y_LABEL_OFFSET + w <= GRAPH_W + 0.01;
      assert.ok(fits, `${name}: ${tick.label} leaves the box`);
    }
    for (let index = 1; index < ys.length; index += 1) assert.ok(ys[index - 1].at.y - ys[index].at.y >= 22 - 1e-6, name);
  }
});

test("an axis on the top or right edge has its numbers outside the plot", () => {
  const negative = graphLayout({ functions: "x - 3", x_min: -8, x_max: -2 });
  assert.ok(negative.ok);
  // Every x is negative, so the y axis is on the right, numbered on its right.
  assert.equal(negative.layout.yLabelSide, "right");
  assert.ok(negative.layout.yAxis[0].x > GRAPH_W * 0.7);
  const below = graphLayout({ functions: "-x^2 - 1", x_min: -3, x_max: 3 });
  assert.ok(below.ok);
  // Every y is negative, so the x axis is along the top, numbered above it.
  assert.equal(below.layout.xLabelSide, "above");
  assert.ok(below.layout.xAxis[0].y < GRAPH_H * 0.3);
  const usual = graphLayout({ functions: "x", x_min: -5, x_max: 5 });
  assert.ok(usual.ok);
  assert.equal(usual.layout.xLabelSide, "below");
  assert.equal(usual.layout.yLabelSide, "left");
});

test("a curve with too many pieces says so", () => {
  const graph = graphLayout({ functions: "tan(x)", x_min: 0, x_max: 100 });
  assert.ok(graph.ok);
  assert.equal(graph.layout.curves[0].length, 20);
  assert.ok(graph.note && /left out/.test(graph.note));
  const plain = graphLayout({ functions: "x", x_min: -5, x_max: 5 });
  assert.ok(plain.ok && plain.note === undefined);
});

test("a graph's layout stays in its box, with axes, labels, curves and points", () => {
  const graph = graphLayout({ functions: "2x+1; x^2-3", x_min: -5, x_max: 5, points: "0,1:intercept; 9,9" });
  assert.ok(graph.ok, graph.ok ? "" : graph.error);
  const { layout } = graph;
  assert.deepEqual(layout.box, { x: 0, y: 0, w: GRAPH_W, h: GRAPH_H });
  const inside = (point: { x: number; y: number }) =>
    point.x >= -0.01 && point.x <= GRAPH_W + 0.01 && point.y >= -0.01 && point.y <= GRAPH_H + 0.01;
  assert.equal(layout.curves.length, 2);
  for (const pieces of layout.curves) {
    assert.ok(pieces.length >= 1);
    for (const piece of pieces) assert.ok(piece.every(inside));
  }
  // The axes cross at the origin, which isn't numbered on either.
  assert.ok(!layout.xTicks.some((tick) => tick.label === "0") && !layout.yTicks.some((tick) => tick.label === "0"));
  assert.ok(layout.xTicks.some((tick) => tick.label === "2"));
  // The x axis runs left to right and the y axis bottom to top.
  assert.ok(layout.xAxis[0].x < layout.xAxis[1].x && layout.yAxis[0].y > layout.yAxis[1].y);
  // Out of range points are dropped.
  assert.deepEqual(
    layout.points.map((point) => point.label),
    ["intercept"],
  );
  assert.ok(layout.points.every((point) => inside(point.at)));
  // The point (0, 1) sits where the line 2x+1 crosses the y axis.
  const [line] = layout.curves[0];
  const target = layout.points[0].at;
  const nearest = line.reduce((best, point) => (Math.abs(point.x - target.x) < Math.abs(best.x - target.x) ? point : best));
  assert.ok(Math.abs(nearest.y - target.y) < 2);
});

test("a graph with a bad function or range draws nothing", () => {
  assert.equal(graphLayout({ functions: "alert(1)", x_min: -5, x_max: 5 }).ok, false);
  assert.equal(graphLayout({ functions: "x", x_min: 5, x_max: 5 }).ok, false);
  assert.equal(graphLayout({ functions: "x", x_min: Number.NaN, x_max: 5 }).ok, false);
  assert.equal(graphLayout({ functions: "x", x_min: -5, x_max: 5, y_min: 3, y_max: 1 }).ok, false);
  assert.equal(graphLayout({ functions: "", x_min: -5, x_max: 5 }).ok, false);
  // Points alone are a graph too.
  assert.ok(graphLayout({ functions: "", x_min: -5, x_max: 5, points: "2,3" }).ok);
  // A range given by halves is ordered.
  assert.ok(graphLayout({ functions: "x", x_min: -5, x_max: 5, y_min: 2 }).ok);
});

test("axes sit on the edge when zero is out of range", () => {
  const graph = graphLayout({ functions: "x", x_min: 2, x_max: 8, y_min: 2, y_max: 8 });
  assert.ok(graph.ok);
  const { layout } = graph;
  // The x axis runs along the bottom and the y axis up the left, each numbered.
  assert.ok(layout.xAxis[0].y > GRAPH_H * 0.8);
  assert.ok(layout.yAxis[0].x < GRAPH_W * 0.2);
  assert.ok(layout.xTicks.some((tick) => tick.label === "2") && layout.yTicks.some((tick) => tick.label === "2"));
});
