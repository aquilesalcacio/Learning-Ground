"use client";

import {
  b64Vecs,
  Box,
  createShapeId,
  DefaultColorStyle,
  type Editor,
  getIndicesBetween,
  react,
  type TLAsset,
  type TLAssetId,
  type TLEventInfo,
  type TLShape,
  type TLShapeId,
  type TLShapePartial,
  toRichText,
} from "tldraw";
import { LG_MATH, LG_MATH_MAX, measureLgMath } from "@/components/lg-math-shape";
import { lgSelectionBounds, linkLgBoard, noteLgActionTarget } from "./lg-board-link";
import {
  arcAt,
  arrowEnds,
  axisStroke,
  densify,
  dotPoints,
  easeOutCubic,
  easeStroke,
  highlightPoints,
  type InkPoint,
  labelledTicks,
  lastPoint,
  loopPoints,
  type NumberLineLayout,
  type NumberLineMark,
  numberLineLayout,
  numberLineStroke,
  partialPath,
  pathLength,
  roundedRectPoints,
  type ShapeKind,
  shapeLayout,
  type ShapeStroke,
  typedText,
  underlinePoints,
} from "./lg-ink";
import { type GraphSpec, graphLayout, tickLabelWidth, Y_LABEL_OFFSET } from "./lg-plot";
import {
  attachPen,
  enqueuePen,
  getPen,
  penDoneLooking,
  penLook,
  type PenStep,
  penRestStep,
  penTapStep,
} from "./lg-tutor-pen";
import {
  boardPageSize,
  documentFiles,
  documentPages,
  fileNames,
  fileOfPage,
  findPage,
  findRegion,
  type LgBounds,
  MARGIN_WIDTH,
  pageFocusBounds,
  pageRegions,
  pageSource,
  placeNewFile,
  regionAt,
  regionBounds,
  regionFocusBounds,
  regionMarginX,
  regionWorkBounds,
  replacePageRegions,
  wholePageRegion,
} from "./lg-regions";
import { LgDocumentError, openHomeworkFile, readHomeworkPage } from "./lg-document";
import { selectionOwner } from "./lg-selection";
import {
  addBoardQuestion,
  addBoardSelection,
  appendMessage,
  clearBoardQuestions,
  clearBoardSelections,
  findBoardQuestion,
  findBoardSelection,
  getActiveDocument,
  getActiveTutor,
  getBoardQuestions,
  getConversationDocument,
  readLgState,
  removeBoardSelections,
  setConversationDocument,
  setLgDocument,
  startConversation,
  subscribeLgState,
  updateBoardQuestion,
} from "./lg-store";
import { resolveLanguage } from "./lg-tutor-prompt";
import {
  type LgBackground,
  type LgDocument,
  type LgDocumentPage,
  type LgLanguage,
  type LgRegion,
  type PenColor,
  TUTOR_COLORS,
  type TutorColor,
} from "./lg-types";

// The seam between the board and the voice session (vision doc, section 8.1).
// Voice client tools and the test buttons both call applyLgAction and nothing else.
// Each action becomes a plan for the tutor's pen (lg-tutor-pen.ts), which draws it by hand while
// the tutor talks: it travels to the problem, then inks the mark stroke by stroke. Tutor marks
// stay out of the undo history, so the student's undo only ever takes their own work.
// Actions aim at a homework region (p1.q3), at a question the tutor wrote on the board (q1), so
// the tutor can teach on a blank board too, or at a spot the student circled to show it (s1).
// Graphs and shapes stand on their own, so they can also go on a free spot of the board.
export type LgAction =
  | { type: "focus_region"; region_id: string }
  | { type: "point_at"; region_id: string }
  | { type: "circle_region"; region_id: string }
  | { type: "underline_region"; region_id: string }
  | { type: "highlight_region"; region_id: string }
  | { type: "draw_arrow"; from_region_id: string; to_region_id: string; label?: string }
  | { type: "write_text"; near_region_id: string; text: string }
  | { type: "write_math"; near_region_id: string; latex: string }
  | { type: "number_line"; near_region_id: string; min: number; max: number; marks?: NumberLineMark[] }
  | {
      type: "plot_graph";
      near_region_id?: string;
      functions: string;
      x_min: number;
      x_max: number;
      y_min?: number;
      y_max?: number;
      points?: string;
    }
  | { type: "draw_shape"; near_region_id?: string; shape: ShapeKind; labels?: string; parts?: number; shaded?: number }
  | { type: "clear" };

const MARGIN_LINE_GAP = 12;
const FOCUS_INSET = 24;
const FOCUS_MS = 450;
// Handwriting in the margin: size "s" text in tldraw's draw font is about this big on the board.
const NOTE_LINE_HEIGHT = 24;
const NOTE_CHAR_WIDTH = 9.5;
const NUMBER_LABEL_WIDTH = 48;
// tldraw's highlighter at size "m" is 16 × 1.5 × 1.12 board units wide.
const HIGHLIGHT_WIDTH = 26.9;
// A written question: tldraw's note is 200 units square before it grows to fit its text.
const QUESTION_NOTE = 200;
const QUESTION_MAX = 160;
const ANSWER_W = MARGIN_WIDTH;
const ANSWER_H = 150;
const ANSWER_TOP_GAP = 40;
const ANSWER_LABEL: Record<LgLanguage, string> = { pt: "Sua resposta", es: "Tu respuesta", en: "Your answer" };

let lgEditor: Editor | null = null;
// The chat whose board is open: its ID, or the draft ID on the start screen.
let lgBoardId: string | null = null;

function tutorMeta(near?: string, question?: string) {
  return { author: "tutor", ...(near ? { near } : {}), ...(question ? { question } : {}) };
}

function tutorColor() {
  return getActiveTutor(readLgState()).color;
}

// The tutor's colour first, then its other colours for a second and third curve. Never black,
// which is the student's pen.
function curveColors(): TutorColor[] {
  const own = tutorColor();
  return [own, ...TUTOR_COLORS.filter((color) => color !== own)];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (from: InkPoint, to: InkPoint, t: number) => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
// Typing speed for the tutor's handwriting.
const typingMs = (text: string, min: number, max: number) => clamp(Array.from(text).length * 35, min, max);

// Repeat marks on one target vary a little, as a hand's would.
let markCount = 0;
const seedFor = (id: string) => `${id}:${(markCount += 1)}`;

const exists = (editor: Editor, id: TLShapeId) => !!editor.getShape(id);

// What the tutor's tools aim at, in board positions.
type LgTarget = {
  id: string;
  // What notes about it are filed under (meta.near), so they stack below the others there. A
  // circled spot's notes go with the region or question it's on.
  near: string;
  // The problem as printed, or the question's note. Circles, underlines and arrows use this.
  bounds: LgBounds;
  // What the board frames to show it, with room for notes.
  focus: LgBounds;
  // Where notes about it are written: from (marginX, top), each below the last.
  marginX: number;
  top: number;
  // Where the student works on it. The pen hovers here while the tutor reads the work.
  work: LgBounds;
};

function resolveTarget(document: LgDocument | null, id: string): LgTarget | null {
  const item = findRegion(document, id);
  if (document && item) {
    const bounds = regionBounds(document, item);
    return {
      id,
      near: id,
      bounds,
      focus: regionFocusBounds(document, item),
      marginX: regionMarginX(document, item),
      top: bounds.y,
      work: regionWorkBounds(document, item),
    };
  }
  const question = findBoardQuestion(readLgState(), id);
  if (!question) return selectionTarget(document, id);
  const all = Box.Common([Box.From(question.card), Box.From(question.answer)]);
  // Notes about a written question go under its answer box, in the same column.
  return {
    id,
    near: id,
    bounds: question.card,
    focus: { x: all.x - 48, y: all.y - 24, w: all.w + 96, h: all.h + 48 + NOTE_LINE_HEIGHT * 4 },
    marginX: question.card.x,
    top: question.card.y,
    work: question.answer,
  };
}

// A spot the student circled: where its loop is now, which moves with its file. Notes about it go
// in the margin of the region or question it's on, beside the spot or below the notes already
// there; on a blank board, just right of it.
function selectionTarget(document: LgDocument | null, id: string): LgTarget | null {
  const selection = findBoardSelection(readLgState(), id);
  const bounds = selection && lgSelectionBounds(id);
  if (!selection || !bounds) return null;
  const parentId = selection.question_id ?? selection.region_id;
  const parent = parentId ? resolveTarget(document, parentId) : null;
  const shown = Box.From(bounds).expandBy(24);
  if (parent) {
    return {
      id,
      near: parent.near,
      bounds,
      focus: Box.Common([Box.From(parent.focus), shown]).toJson(),
      marginX: parent.marginX,
      top: Math.max(parent.top, bounds.y),
      work: bounds,
    };
  }
  return {
    id,
    near: id,
    bounds,
    focus: { x: shown.x, y: shown.y, w: shown.w + 32 + MARGIN_WIDTH, h: shown.h + NOTE_LINE_HEIGHT * 4 },
    marginX: bounds.x + bounds.w + 32,
    top: bounds.y,
    work: bounds,
  };
}

// Where the pen points at a target: just inside its upper left.
function targetSpot(target: LgTarget): InkPoint {
  const { bounds } = target;
  return { x: bounds.x + Math.min(24, bounds.w * 0.1), y: bounds.y + Math.min(18, bounds.h * 0.4) };
}

// Where the pen rests after marking a target: just past its right edge, clear of the problem.
function besideTarget(editor: Editor, target: LgTarget): () => InkPoint {
  return () => {
    const zoom = editor.getZoomLevel();
    return { x: target.bounds.x + target.bounds.w + 34 / zoom, y: target.bounds.y + target.bounds.h / 2 };
  };
}

// Pans to something first when it isn't on screen, so the student sees the mark being made.
function revealStep(editor: Editor, bounds: () => LgBounds | null, focus: () => LgBounds | null = bounds): PenStep {
  const step: PenStep = {
    duration: FOCUS_MS,
    mode: "travel",
    begin: () => {
      const shown = bounds();
      const frame = focus();
      if (!shown || !frame || editor.getViewportPageBounds().contains(Box.From(shown))) {
        step.duration = 0;
        return;
      }
      editor.zoomToBounds(frame, { inset: FOCUS_INSET, animation: { duration: FOCUS_MS } });
    },
  };
  return step;
}

const revealTarget = (editor: Editor, target: LgTarget) => revealStep(editor, () => target.bounds, () => target.focus);

// The board glides to the target while the pen flies there.
function focusStep(editor: Editor, target: LgTarget): PenStep {
  const spot = targetSpot(target);
  let from = spot;
  return {
    duration: FOCUS_MS,
    mode: "travel",
    begin: () => {
      from = { x: getPen().x, y: getPen().y };
      editor.zoomToBounds(target.focus, { inset: FOCUS_INSET, animation: { duration: FOCUS_MS } });
    },
    frame: (t) => lerp(from, spot, easeOutCubic(t)),
  };
}

// tldraw stores a stroke's points relative to the shape, as delta-encoded base64.
function segmentsOf(points: InkPoint[], origin: InkPoint) {
  const local = points.map((point) => ({ x: point.x - origin.x, y: point.y - origin.y }));
  return [{ type: "free" as const, path: b64Vecs.encodePoints(local, 2), dim: 2 as const }];
}

type InkOptions = {
  duration: number;
  near?: string;
  question?: string;
  size?: "s" | "m" | "l";
  // A closed stroke, filled: "fill" in full colour for a dot, "solid" in a light tint for a shaded part.
  fill?: "fill" | "solid";
  dash?: "draw" | "dashed";
  hold?: boolean;
  // The tutor's colour unless given, such as for a graph's second curve.
  color?: TutorColor;
};

// One stroke, drawn along its points from the first to the last. The points are read when the
// step starts, so a stroke placed below earlier notes sees them.
function inkStep(editor: Editor, kind: "draw" | "highlight", source: () => InkPoint[], options: InkOptions): PenStep {
  const id = createShapeId();
  let points: InkPoint[] = [];
  let origin: InkPoint = { x: 0, y: 0 };
  const draw = (part: InkPoint[], isComplete: boolean) => {
    if (!exists(editor, id)) return;
    const segments = segmentsOf(part, origin);
    if (kind === "draw") editor.updateShape({ id, type: "draw", props: { segments, isComplete } });
    else editor.updateShape({ id, type: "highlight", props: { segments, isComplete } });
  };
  return {
    at: () => {
      points = source();
      origin = points[0] ?? origin;
      return points.length ? origin : null;
    },
    hold: options.hold ?? true,
    duration: options.duration,
    mode: "draw",
    begin: () => {
      if (!points.length) return;
      const base = { id, x: origin.x, y: origin.y, meta: tutorMeta(options.near, options.question) };
      const segments = segmentsOf(points.slice(0, 1), origin);
      const size = options.size ?? "m";
      if (kind === "draw") {
        editor.createShape({
          ...base,
          type: "draw",
          props: {
            color: options.color ?? tutorColor(),
            size,
            dash: options.dash ?? "draw",
            fill: options.fill ?? "none",
            isClosed: !!options.fill,
            segments,
            isComplete: false,
          },
        });
      } else {
        editor.createShape({
          ...base,
          type: "highlight",
          props: { color: options.color ?? tutorColor(), size, segments, isComplete: false },
        });
      }
    },
    frame: (t) => {
      if (!points.length) return;
      const part = partialPath(points, easeStroke(t));
      draw(part, false);
      return lastPoint(part);
    },
    end: () => draw(points, true),
  };
}

// The next free line in the margin beside a target, below the tutor's earlier notes there.
function nextNoteY(editor: Editor, target: LgTarget): number {
  return editor
    .getCurrentPageShapes()
    .filter((shape) => shape.meta.author === "tutor" && (shape.meta.near === target.near || shape.meta.question === target.near))
    .reduce((next, shape) => Math.max(next, (editor.getShapePageBounds(shape)?.maxY ?? 0) + MARGIN_LINE_GAP), target.top);
}

// Where the pen sits while it writes: just after the text so far, wrapping as the note does.
function caretAt(origin: InkPoint, shown: string, width = MARGIN_WIDTH): InkPoint {
  const written = Array.from(shown).length * NOTE_CHAR_WIDTH;
  const line = Math.floor(written / width);
  return { x: origin.x + (written % width), y: origin.y + (line + 0.75) * NOTE_LINE_HEIGHT };
}

type TextPlace = { x: number; y: number; w: number; align: "start" | "middle" };

// Text written letter by letter, as the tutor's handwriting.
function textStep(
  editor: Editor,
  place: () => TextPlace,
  text: string,
  options: { near?: string; question?: string; font?: "draw" | "mono"; duration?: number; hold?: boolean; color?: TutorColor },
): PenStep {
  const id = createShapeId();
  let spot: TextPlace = { x: 0, y: 0, w: MARGIN_WIDTH, align: "start" };
  let shown = "";
  const write = (next: string) => {
    if (next === shown || !exists(editor, id)) return;
    shown = next;
    editor.updateShape({ id, type: "text", props: { richText: toRichText(next) } });
  };
  const caret = () =>
    spot.align === "middle"
      ? { x: spot.x + spot.w / 2 + (Array.from(shown).length * NOTE_CHAR_WIDTH) / 2, y: spot.y + NOTE_LINE_HEIGHT * 0.75 }
      : caretAt(spot, shown, spot.w);
  return {
    at: () => {
      spot = place();
      return spot.align === "middle" ? { x: spot.x + spot.w / 2, y: spot.y + NOTE_LINE_HEIGHT * 0.75 } : caretAt(spot, "", spot.w);
    },
    hold: options.hold ?? true,
    duration: options.duration ?? typingMs(text, 280, 1400),
    mode: "draw",
    begin: () => {
      editor.createShape({
        id,
        type: "text",
        x: spot.x,
        y: spot.y,
        meta: tutorMeta(options.near, options.question),
        props: {
          richText: toRichText(""),
          color: options.color ?? tutorColor(),
          size: "s",
          font: options.font ?? "draw",
          autoSize: false,
          w: spot.w,
          textAlign: spot.align,
        },
      });
    },
    frame: (t) => {
      write(typedText(text, t));
      return caret();
    },
    end: () => write(text),
  };
}

function noteSteps(editor: Editor, target: LgTarget, text: string, font: "draw" | "mono"): PenStep[] {
  const place = (): TextPlace => ({ x: target.marginX, y: nextNoteY(editor, target), w: MARGIN_WIDTH, align: "start" });
  return [revealTarget(editor, target), textStep(editor, place, text, { near: target.near, font }), penRestStep()];
}

// A hint equation, rendered with KaTeX and revealed left to right as the pen writes along it.
function mathSteps(editor: Editor, target: LgTarget, latex: string): PenStep[] {
  const id = createShapeId();
  const source = latex.trim().slice(0, LG_MATH_MAX);
  const size = measureLgMath(source);
  let spot: InkPoint = { x: target.marginX, y: target.top };
  const baseline = () => spot.y + size.h * 0.62;
  return [
    revealTarget(editor, target),
    {
      at: () => {
        spot = { x: target.marginX, y: nextNoteY(editor, target) };
        return { x: spot.x + 6, y: baseline() };
      },
      hold: true,
      duration: clamp(size.w * 5, 450, 1500),
      mode: "draw",
      begin: () => {
        editor.createShape({
          id,
          type: LG_MATH,
          x: spot.x,
          y: spot.y,
          meta: tutorMeta(target.near),
          props: { latex: source, w: size.w, h: size.h, color: tutorColor(), reveal: 0 },
        });
      },
      frame: (t) => {
        if (exists(editor, id)) editor.updateShape({ id, type: LG_MATH, props: { reveal: t } });
        // The pen writes along the line, with a small up and down as a hand does.
        return { x: spot.x + 6 + (size.w - 12) * t, y: baseline() + Math.sin(t * Math.PI * 9) * 4 };
      },
      end: () => {
        if (exists(editor, id)) editor.updateShape({ id, type: LG_MATH, props: { reveal: 1 } });
      },
    },
    penRestStep(),
  ];
}

// The arrow grows along its final curve, then its label is written at the curve's middle.
function arrowSteps(editor: Editor, from: LgTarget, to: LgTarget, label: string): PenStep[] {
  const id = createShapeId();
  const { start, end, bend } = arrowEnds(from.bounds, to.bounds);
  const middle = arcAt(start, end, bend, 0.5).point;
  const steps: PenStep[] = [
    revealTarget(editor, from),
    {
      at: () => start,
      hold: true,
      duration: 480,
      mode: "draw",
      begin: () => {
        const first = arcAt(start, end, bend, 0.02);
        editor.createShape({
          id,
          type: "arrow",
          x: 0,
          y: 0,
          meta: tutorMeta(),
          props: { color: tutorColor(), start, end: first.point, bend: first.bend, richText: toRichText("") },
        });
      },
      frame: (t) => {
        const arc = arcAt(start, end, bend, Math.max(0.02, easeStroke(t)));
        if (exists(editor, id)) editor.updateShape({ id, type: "arrow", props: { end: arc.point, bend: arc.bend } });
        return arc.point;
      },
      end: () => {
        if (exists(editor, id)) editor.updateShape({ id, type: "arrow", props: { end, bend } });
      },
    },
  ];
  if (label) {
    let shown = "";
    const write = (next: string) => {
      if (next === shown || !exists(editor, id)) return;
      shown = next;
      editor.updateShape({ id, type: "arrow", props: { richText: toRichText(next) } });
    };
    steps.push({
      at: () => middle,
      duration: typingMs(label, 200, 900),
      mode: "draw",
      frame: (t) => write(typedText(label, t)),
      end: () => write(label),
    });
  }
  steps.push(penRestStep(() => ({ x: end.x - 34 / editor.getZoomLevel(), y: end.y + 18 / editor.getZoomLevel() })));
  return steps;
}

// A number line beside a target: the axis is drawn left to right with its ticks, the numbers
// are written under it, then each marked value gets a dot and its label.
function numberLineSteps(editor: Editor, target: LgTarget, min: number, max: number, marks: NumberLineMark[]): PenStep[] | null {
  const sample = numberLineLayout({ x: 0, y: 0 }, MARGIN_WIDTH, min, max, marks);
  if (!sample) return null;
  let layout: NumberLineLayout | null = null;
  // Placed once, when the axis starts, below anything already written beside the target.
  const place = () =>
    (layout ??= numberLineLayout({ x: target.marginX, y: nextNoteY(editor, target) }, MARGIN_WIDTH, min, max, marks));
  const near = target.near;
  const steps: PenStep[] = [
    revealTarget(editor, target),
    inkStep(
      editor,
      "draw",
      () => {
        const placed = place();
        return placed ? numberLineStroke(placed) : [];
      },
      { duration: 720, near, size: "s" },
    ),
  ];
  labelledTicks(sample).forEach((tick, index) => {
    steps.push(
      textStep(
        editor,
        () => {
          const placed = place();
          const at = placed ? labelledTicks(placed)[index] : tick;
          return { x: at.x - NUMBER_LABEL_WIDTH / 2, y: (placed?.y ?? 0) + 10, w: NUMBER_LABEL_WIDTH, align: "middle" };
        },
        tick.label,
        { near, duration: 90, hold: false },
      ),
    );
  });
  sample.dots.forEach((dot, index) => {
    const center = () => {
      const placed = place();
      return placed ? { x: placed.dots[index].x, y: placed.y } : null;
    };
    steps.push(
      inkStep(
        editor,
        "draw",
        () => {
          const at = center();
          return at ? dotPoints(at, 5) : [];
        },
        { duration: 160, near, size: "s", fill: "fill", hold: false },
      ),
      textStep(
        editor,
        () => {
          const at = center() ?? { x: 0, y: 0 };
          return { x: at.x - NUMBER_LABEL_WIDTH / 2, y: at.y - 36, w: NUMBER_LABEL_WIDTH, align: "middle" };
        },
        dot.label,
        { near, duration: typingMs(dot.label, 120, 400), hold: false },
      ),
    );
  });
  steps.push(
    penRestStep(() => {
      const placed = place();
      const zoom = editor.getZoomLevel();
      return placed ? { x: placed.axis[1].x + 14 / zoom, y: placed.axis[1].y + 22 / zoom } : null;
    }),
  );
  return steps;
}

// Graphs and shapes: laid out once from (0, 0) by lg-plot.ts and lg-ink.ts, and moved into place
// when their first step starts. Beside a target they go in its margin, below what's already
// written there; with no target, on a free spot of the board.
function figurePlace(editor: Editor, target: LgTarget | null, size: { w: number; h: number }) {
  let origin: InkPoint | null = null;
  const place = () =>
    (origin ??= target ? { x: target.marginX, y: nextNoteY(editor, target) } : freeSpot(editor, size.w, size.h));
  return {
    at: (point: InkPoint): InkPoint => {
      const by = place();
      return { x: by.x + point.x, y: by.y + point.y };
    },
    box: (): LgBounds => {
      const by = place();
      return { x: by.x, y: by.y, w: size.w, h: size.h };
    },
  };
}

// Shows the figure before it's drawn, with its target when it has one.
function revealFigure(editor: Editor, target: LgTarget | null, box: () => LgBounds): PenStep {
  return revealStep(editor, box, () => {
    const shown = Box.From(box()).expandBy(24);
    return target ? Box.Common([Box.From(target.focus), shown]) : shown;
  });
}

const restBelow = (editor: Editor, box: () => LgBounds) =>
  penRestStep(() => {
    const placed = box();
    const zoom = editor.getZoomLevel();
    return { x: placed.x + placed.w + 14 / zoom, y: placed.y + placed.h - 10 / zoom };
  });

const CURVE_MS = 900;

// A graph: the axes with their ticks, the numbers, each curve left to right in its own colour,
// one stroke per unbroken piece, then a dot and a label for each point. A function that can't be
// read draws nothing: the reason is logged and no steps come back.
function graphSteps(editor: Editor, target: LgTarget | null, spec: GraphSpec): PenStep[] {
  const graph = graphLayout(spec);
  if (!graph.ok) {
    console.warn(`[lg] plot_graph can't draw this: ${graph.error}.`, spec);
    return [];
  }
  if (graph.note) console.warn(`[lg] plot_graph: ${graph.note}.`, spec);
  const { layout } = graph;
  const { at, box } = figurePlace(editor, target, layout.box);
  const near = target?.near;
  const axis = (ends: [InkPoint, InkPoint], ticks: { at: InkPoint }[]) => () =>
    axisStroke(at(ends[0]), at(ends[1]), ticks.map((tick) => at(tick.at)));
  const steps: PenStep[] = [
    revealFigure(editor, target, box),
    inkStep(editor, "draw", axis(layout.xAxis, layout.xTicks), { duration: 520, near, size: "s" }),
    inkStep(editor, "draw", axis(layout.yAxis, layout.yTicks), { duration: 440, near, size: "s", hold: false }),
  ];
  const label = (text: string, place: () => TextPlace) => textStep(editor, place, text, { near, duration: 90, hold: false });
  // Each number in a box as wide as its text, so it stays on one line, on its axis's label side.
  for (const tick of layout.xTicks.filter((item) => item.label)) {
    const w = tickLabelWidth(tick.label);
    steps.push(
      label(tick.label, () => {
        const spot = at(tick.at);
        const y = layout.xLabelSide === "below" ? spot.y + 7 : spot.y - 7 - NOTE_LINE_HEIGHT;
        return { x: spot.x - w / 2, y, w, align: "middle" };
      }),
    );
  }
  for (const tick of layout.yTicks.filter((item) => item.label)) {
    const w = tickLabelWidth(tick.label);
    steps.push(
      label(tick.label, () => {
        const spot = at(tick.at);
        const x = layout.yLabelSide === "left" ? spot.x - Y_LABEL_OFFSET - w : spot.x + Y_LABEL_OFFSET;
        return { x, y: spot.y - NOTE_LINE_HEIGHT / 2, w, align: "middle" };
      }),
    );
  }
  const colors = curveColors();
  layout.curves.forEach((pieces, index) => {
    const total = pieces.reduce((sum, piece) => sum + pathLength(piece), 0) || 1;
    for (const piece of pieces) {
      steps.push(
        inkStep(editor, "draw", () => densify(piece.map(at)), {
          duration: Math.max(60, (CURVE_MS * pathLength(piece)) / total),
          near,
          color: colors[index % colors.length],
          hold: false,
        }),
      );
    }
  });
  for (const point of layout.points) {
    steps.push(
      inkStep(editor, "draw", () => dotPoints(at(point.at), 4), { duration: 140, near, size: "s", fill: "fill", hold: false }),
      textStep(
        editor,
        () => {
          const spot = at(point.at);
          const w = Array.from(point.label).length * NOTE_CHAR_WIDTH + 12;
          return { x: spot.x + 6, y: spot.y - NOTE_LINE_HEIGHT - 2, w, align: "start" };
        },
        point.label,
        { near, duration: typingMs(point.label, 120, 450), hold: false },
      ),
    );
  }
  steps.push(restBelow(editor, box));
  return steps;
}

// How each part of a shape is drawn.
const SHAPE_INK: Record<ShapeStroke["kind"], Omit<InkOptions, "duration" | "near"> & { duration?: number }> = {
  outline: { size: "m" },
  divider: { duration: 140, size: "s", hold: false },
  shade: { duration: 220, size: "s", fill: "solid", hold: false },
  marker: { duration: 220, size: "s", hold: false },
  dot: { duration: 100, size: "s", fill: "fill", hold: false },
  guide: { duration: 320, size: "s", dash: "dashed", hold: false },
};

// A shape: its outline by hand, then a fraction's dividers and shaded parts, the right-angle
// marker, radius or height, and its labels, letter by letter. A shape it doesn't know draws
// nothing: the reason is logged and no steps come back.
function shapeSteps(editor: Editor, target: LgTarget | null, action: Extract<LgAction, { type: "draw_shape" }>): PenStep[] {
  const layout = shapeLayout(action.shape, action, seedFor(target?.id ?? "board"));
  if (!layout) {
    console.warn(`[lg] draw_shape doesn't know the shape "${action.shape}".`, action);
    return [];
  }
  const { at, box } = figurePlace(editor, target, layout.box);
  const near = target?.near;
  const steps: PenStep[] = [revealFigure(editor, target, box)];
  for (const stroke of layout.strokes) {
    const { duration, ...ink } = SHAPE_INK[stroke.kind];
    steps.push(
      inkStep(editor, "draw", () => stroke.points.map(at), {
        ...ink,
        near,
        duration: duration ?? clamp(pathLength(stroke.points) * 1.4, 500, 1100),
      }),
    );
  }
  for (const label of layout.labels) {
    const w = Array.from(label.text).length * NOTE_CHAR_WIDTH + 16;
    steps.push(
      textStep(
        editor,
        () => {
          const spot = at(label.at);
          return { x: spot.x - w / 2, y: spot.y - NOTE_LINE_HEIGHT / 2, w, align: "middle" };
        },
        label.text,
        { near, duration: typingMs(label.text, 120, 500), hold: false },
      ),
    );
  }
  steps.push(restBelow(editor, box));
  return steps;
}

// The chat the board belongs to, started now if this is the start screen's board.
function boardConversation(): string {
  return readLgState().active_conversation_id ?? startConversation();
}

// Every tutor mark fades out together, then goes, with the tutor's written questions and the
// spots the student circled. The student's work stays, including what they wrote in an answer box.
function clearSteps(editor: Editor): PenStep[] {
  let marks: TLShape[] = [];
  return [
    {
      duration: 220,
      mode: "idle",
      begin: () => {
        marks = editor
          .getCurrentPageShapes()
          .filter((shape) => shape.meta.author === "tutor" || shape.meta.kind === "selection");
      },
      frame: (t) => {
        editor.updateShapes(
          marks
            .filter((shape) => exists(editor, shape.id))
            .map((shape) => ({ id: shape.id, type: shape.type, opacity: shape.opacity * (1 - t) })),
        );
      },
      end: () => {
        editor.deleteShapes(marks.map((shape) => shape.id).filter((id) => exists(editor, id)));
        const conversation_id = readLgState().active_conversation_id;
        if (conversation_id) {
          clearBoardQuestions(conversation_id);
          clearBoardSelections(conversation_id);
        }
      },
    },
  ];
}

function targetSteps(editor: Editor, target: LgTarget, action: LgAction): PenStep[] | null {
  const rest = penRestStep(besideTarget(editor, target));
  switch (action.type) {
    case "focus_region":
      return [focusStep(editor, target)];
    case "point_at":
      return [revealTarget(editor, target), penTapStep(() => targetSpot(target)), penRestStep()];
    case "circle_region": {
      const points = loopPoints(target.bounds, seedFor(target.id));
      return [revealTarget(editor, target), inkStep(editor, "draw", () => points, { duration: 560 }), rest];
    }
    case "underline_region": {
      const points = underlinePoints(target.bounds, seedFor(target.id));
      return [revealTarget(editor, target), inkStep(editor, "draw", () => points, { duration: 340 }), rest];
    }
    case "highlight_region": {
      const points = highlightPoints(target.bounds, seedFor(target.id), HIGHLIGHT_WIDTH);
      const duration = clamp(pathLength(points) * 0.8, 380, 1300);
      return [revealTarget(editor, target), inkStep(editor, "highlight", () => points, { duration }), rest];
    }
    case "write_text":
      return noteSteps(editor, target, action.text, "draw");
    case "write_math":
      return mathSteps(editor, target, action.latex);
    case "number_line":
      return numberLineSteps(editor, target, action.min, action.max, action.marks ?? []);
    default:
      return null;
  }
}

// The steps for an action, or null when it aims at nothing on the board. A figure that can't be
// drawn logs why and comes back with no steps.
function planLgAction(editor: Editor, document: LgDocument | null, action: LgAction): PenStep[] | null {
  if (action.type === "clear") return clearSteps(editor);
  if (action.type === "plot_graph" || action.type === "draw_shape") {
    // A figure means something on its own, so one aimed at an ID that isn't on the board goes on
    // a free spot instead of being dropped.
    const target = action.near_region_id ? resolveTarget(document, action.near_region_id) : null;
    if (action.near_region_id && !target) {
      console.warn("[lg] No region or written question has this ID, so it goes on a free spot:", action);
    }
    return action.type === "plot_graph" ? graphSteps(editor, target, action) : shapeSteps(editor, target, action);
  }
  if (action.type === "draw_arrow") {
    const from = resolveTarget(document, action.from_region_id);
    const to = resolveTarget(document, action.to_region_id);
    return from && to ? arrowSteps(editor, from, to, action.label ?? "") : null;
  }
  const target = resolveTarget(document, "region_id" in action ? action.region_id : action.near_region_id);
  return target ? targetSteps(editor, target, action) : null;
}

export function applyLgAction(action: LgAction) {
  const editor = lgEditor;
  if (!editor) {
    console.warn("[lg] No board is open, so this action did nothing:", action);
    return;
  }
  const document = getActiveDocument(readLgState());
  noteLgActionTarget(action as { region_id?: string; near_region_id?: string });
  const steps = planLgAction(editor, document, action);
  if (!steps) {
    // Without homework or a written question there's nothing to aim at: the tutor would mark empty space.
    console.warn("[lg] This action names no region or written question on the board, or can't be drawn:", action);
    return;
  }
  // A figure that can't be drawn has already said why.
  if (!steps.length) return;
  enqueuePen(steps);
}

// A free spot on screen for a question written on a blank board: centred near the top of the
// view, moved down past anything already there.
function freeSpot(editor: Editor, w: number, h: number): InkPoint {
  const view = editor.getViewportPageBounds();
  const zoom = editor.getZoomLevel();
  const x = view.x + view.w / 2 - w / 2;
  let y = view.y + Math.min(72 / zoom, view.h * 0.1);
  const taken = editor
    .getCurrentPageShapes()
    .filter((shape) => shape.meta.kind !== "region")
    .flatMap((shape) => editor.getShapePageBounds(shape) ?? []);
  for (let tries = 0; tries < 50; tries += 1) {
    const spot = new Box(x, y, w, h).expandBy(16);
    const hit = taken.find((box) => box.collides(spot));
    if (!hit) break;
    y = hit.maxY + 32;
  }
  return { x, y };
}

export type LgAskOutcome = { ok: true; id: string } | { ok: false; message: string };

// The tutor writes a question on the board for the student to answer: a note in the tutor's
// colour with the question, written as the tutor speaks, then "Your answer" and a dashed box to
// answer in. It goes beside a region, or on a free spot when there's no homework or no region.
// Returns at once with the question's ID, which the tutor's other tools and Check my work accept.
export function askLgQuestion(question: string, near_region_id = ""): LgAskOutcome {
  const editor = lgEditor;
  if (!editor) return { ok: false, message: "No board is open, so the question couldn't be written." };
  const text = question.replace(/\s+/g, " ").trim().slice(0, QUESTION_MAX);
  if (!text) return { ok: false, message: "The question was empty, so nothing was written." };
  const state = readLgState();
  const near = near_region_id ? resolveTarget(getActiveDocument(state), near_region_id) : null;
  const conversation_id = boardConversation();
  // Placed for now where it will most likely go; the first step places it for real.
  const guess = near
    ? { x: near.marginX, y: nextNoteY(editor, near) }
    : freeSpot(editor, ANSWER_W, QUESTION_NOTE + ANSWER_TOP_GAP + ANSWER_H);
  const added = addBoardQuestion(conversation_id, (id) => ({
    id,
    text,
    near: near?.near ?? "",
    card: { x: guess.x, y: guess.y, w: QUESTION_NOTE, h: QUESTION_NOTE },
    answer: { x: guess.x, y: guess.y + QUESTION_NOTE + ANSWER_TOP_GAP, w: ANSWER_W, h: ANSWER_H },
  }));
  if (!added) return { ok: false, message: "The question couldn't be saved with this chat." };
  enqueuePen(questionSteps(editor, conversation_id, added.id, text, near));
  return { ok: true, id: added.id };
}

function questionSteps(editor: Editor, conversation_id: string, id: string, text: string, near: LgTarget | null): PenStep[] {
  const noteId = createShapeId();
  const language = resolveLanguage(getActiveTutor(readLgState()), readLgState().profile);
  let origin: InkPoint | null = null;
  // Where the question goes, decided when its first step starts, below anything written before it.
  const place = () =>
    (origin ??= near
      ? { x: near.marginX, y: nextNoteY(editor, near) }
      : freeSpot(editor, ANSWER_W, QUESTION_NOTE + ANSWER_TOP_GAP + ANSWER_H));
  const noteBox = () => {
    const at = place();
    return editor.getShapePageBounds(noteId) ?? new Box(at.x, at.y, QUESTION_NOTE, QUESTION_NOTE);
  };
  const answerBox = (): LgBounds => {
    const note = noteBox();
    return { x: note.x, y: note.maxY + ANSWER_TOP_GAP, w: ANSWER_W, h: ANSWER_H };
  };
  const whole = () => {
    const at = place();
    return { x: at.x, y: at.y, w: ANSWER_W, h: QUESTION_NOTE + ANSWER_TOP_GAP + ANSWER_H };
  };
  let shown = "";
  const write = (next: string) => {
    if (next === shown || !exists(editor, noteId)) return;
    shown = next;
    editor.updateShape({ id: noteId, type: "note", props: { richText: toRichText(next) } });
  };
  const nearId = near?.near;
  return [
    revealStep(editor, whole, () => {
      const box = whole();
      return { x: box.x - 48, y: box.y - 24, w: box.w + 96, h: box.h + 48 };
    }),
    {
      at: () => {
        const at = place();
        return { x: at.x + 16, y: at.y + 28 };
      },
      hold: true,
      duration: typingMs(text, 500, 2600),
      mode: "draw",
      begin: () => {
        const at = place();
        editor.createShape({
          id: noteId,
          type: "note",
          x: at.x,
          y: at.y,
          meta: tutorMeta(nearId, id),
          props: {
            color: tutorColor(),
            size: "s",
            font: "draw",
            align: "start",
            verticalAlign: "start",
            richText: toRichText(""),
          },
        });
      },
      frame: (t) => {
        write(typedText(text, t));
        const note = noteBox();
        return caretAt({ x: note.x + 16, y: note.y + 12 }, shown, QUESTION_NOTE - 32);
      },
      end: () => {
        write(text);
        // Now the note has its final size, the answer box goes under it.
        updateBoardQuestion(conversation_id, id, { card: noteBox().toJson(), answer: answerBox() });
      },
    },
    textStep(
      editor,
      () => {
        const box = answerBox();
        return { x: box.x, y: box.y - NOTE_LINE_HEIGHT - 6, w: box.w, align: "start" };
      },
      ANSWER_LABEL[language],
      { near: nearId, question: id, duration: 260, hold: false },
    ),
    inkStep(editor, "draw", () => roundedRectPoints(answerBox(), 12), {
      duration: 700,
      near: nearId,
      question: id,
      size: "s",
      dash: "dashed",
      hold: false,
    }),
    penRestStep(() => {
      const box = answerBox();
      return { x: box.x + box.w + 30 / editor.getZoomLevel(), y: box.y + box.h / 2 };
    }),
  ];
}

// While the tutor reads the student's work, its pen hovers over that work in small loops.
export function lookAtLgWork(region_id: string) {
  const target = lgEditor ? resolveTarget(getActiveDocument(readLgState()), region_id) : null;
  const work = target?.work;
  penLook(work ? { x: work.x + Math.min(work.w * 0.4, 160), y: work.y + Math.min(work.h * 0.5, 90) } : null);
}

// While the tutor looks something up that isn't on the board, such as the student's progress, its
// pen thinks in the middle of the view. End it with doneLookingAtLgWork, always: until then the
// thinking step holds up every mark queued after it.
export function lookAtLgBoard() {
  const view = lgEditor?.getViewportPageBounds();
  penLook(view ? { x: view.x + view.w / 2, y: view.y + view.h / 2 } : null);
}

// The pen stops looking; it celebrates when the work was right.
export function doneLookingAtLgWork(correct: boolean) {
  penDoneLooking(correct);
}

// Told when the student has written in an answer box and then paused, so the tutor can check it.
const ANSWER_IDLE_MS = 4000;
const answerListeners = new Set<(question_id: string) => void>();

export function onLgAnswerWritten(listener: (question_id: string) => void) {
  answerListeners.add(listener);
  return () => {
    answerListeners.delete(listener);
  };
}

function watchAnswers(editor: Editor) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const stop = editor.store.listen(
    ({ changes }) => {
      const questions = getBoardQuestions(readLgState());
      if (!questions.length) return;
      const touched = [...Object.values(changes.added), ...Object.values(changes.updated).map(([, next]) => next)];
      for (const record of touched) {
        if (record.typeName !== "shape" || record.meta.author || record.meta.kind) continue;
        const bounds = editor.getShapePageBounds(record.id);
        const question = bounds && questions.find((item) => Box.From(item.answer).expandBy(24).collides(bounds));
        if (!question) continue;
        clearTimeout(timers.get(question.id));
        timers.set(
          question.id,
          setTimeout(() => {
            timers.delete(question.id);
            answerListeners.forEach((listener) => listener(question.id));
          }, ANSWER_IDLE_MS),
        );
      }
    },
    { source: "user", scope: "document" },
  );
  return () => {
    stop();
    timers.forEach((timer) => clearTimeout(timer));
  };
}

// "Show the tutor": the student taps or circles something on the board (lg-point-tool.ts). The
// loop stays as a draw shape in its own style, kept out of the undo history like the homework, and
// is saved with the chat as s1, s2... so the tutor can aim at it and check what's inside.
// It carries meta.kind, so it never counts as the student's work or starts a chat by itself.
const SELECTION_STYLE = { color: "light-blue", dash: "dashed", size: "m", fill: "none" } as const;
const selectionListeners = new Set<(selection_id: string) => void>();

// Told when the student circles or taps something, with the spot's ID.
export function onLgSelection(listener: (selection_id: string) => void) {
  selectionListeners.add(listener);
  return () => {
    selectionListeners.delete(listener);
  };
}

// Draws the student's loop as it grows, then closed once it's done. Returns the shape's ID.
export function inkLgSelection(editor: Editor, id: TLShapeId | null, points: InkPoint[], done: boolean): TLShapeId {
  const origin = points[0] ?? { x: 0, y: 0 };
  const segments = segmentsOf(points, origin);
  const shapeId = id ?? createShapeId();
  editor.run(
    () => {
      if (!exists(editor, shapeId)) {
        editor.createShape({
          id: shapeId,
          type: "draw",
          x: origin.x,
          y: origin.y,
          meta: { kind: "selection" },
          props: { ...SELECTION_STYLE, isClosed: done, segments, isComplete: done },
        });
      } else {
        editor.updateShape({ id: shapeId, type: "draw", x: origin.x, y: origin.y, props: { isClosed: done, segments, isComplete: done } });
      }
    },
    { history: "ignore" },
  );
  return shapeId;
}

export function removeLgSelectionInk(editor: Editor, id: TLShapeId) {
  if (exists(editor, id)) editor.run(() => editor.deleteShape(id), { history: "ignore" });
}

// Loops the chat no longer lists go: past the 20 it keeps, cleared, or a loop still being drawn
// when the board closed.
function pruneSelectionLoops(editor: Editor, conversation_id: string | null) {
  const listed = new Set(
    (readLgState().conversations.find((item) => item.id === conversation_id)?.board_selections ?? []).map((item) => item.id),
  );
  const strays = editor
    .getCurrentPageShapes()
    .filter((shape) => shape.meta.kind === "selection" && !listed.has(String(shape.meta.selection_id)));
  if (strays.length) editor.run(() => editor.deleteShapes(strays), { history: "ignore" });
}

// Saves the finished loop as the next spot, on whatever it was drawn on, and tells the listeners.
// Circling on the start screen begins the chat, as a first stroke does. Returns the spot's ID.
export function recordLgSelection(editor: Editor, shapeId: TLShapeId, bounds: LgBounds): string | null {
  if (editor !== lgEditor) {
    removeLgSelectionInk(editor, shapeId);
    return null;
  }
  const state = readLgState();
  const center = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  const owner = selectionOwner(center, getBoardQuestions(state), regionAt(getActiveDocument(state), center)?.region_id);
  const conversation_id = boardConversation();
  const added = addBoardSelection(conversation_id, (id) => ({ id, bounds, ...owner, created_at: Date.now() }));
  if (!added) {
    removeLgSelectionInk(editor, shapeId);
    return null;
  }
  editor.run(
    () => editor.updateShape({ id: shapeId, type: "draw", meta: { kind: "selection", selection_id: added.id } }),
    { history: "ignore" },
  );
  pruneSelectionLoops(editor, conversation_id);
  noteLgActionTarget({ region_id: added.id });
  selectionListeners.forEach((listener) => listener(added.id));
  return added.id;
}

export function setLgPenColor(color: PenColor) {
  lgEditor?.setStyleForNextShapes(DefaultColorStyle, color);
  // Recolor an existing selection too, so picking a color after selecting works.
  const editor = lgEditor;
  if (editor && editor.getSelectedShapeIds().length > 0) {
    editor.setStyleForSelectedShapes(DefaultColorStyle, color);
  }
}

// The tools the floating pencil menu exposes (vision doc, section 4.1).
// "lg-point" is the student's Show the tutor tool (lg-point-tool.ts).
export const LG_TOOLS = ["select", "hand", "draw", "eraser", "text", "arrow", "laser", "lg-point"] as const;
export type LgTool = (typeof LG_TOOLS)[number];

function isLgTool(id: string): id is LgTool {
  return (LG_TOOLS as readonly string[]).includes(id);
}

// The pencil menu reads the tool from the editor rather than tracking its own,
// so tldraw's keyboard shortcuts keep the menu honest.
let lgTool: LgTool = "draw";
const toolListeners = new Set<() => void>();

export function getLgTool(): LgTool {
  return lgTool;
}

export function subscribeLgTool(listener: () => void) {
  toolListeners.add(listener);
  return () => toolListeners.delete(listener);
}

function setToolFromEditor(editor: Editor) {
  const id = editor.getCurrentToolId();
  const next = isLgTool(id) ? id : lgTool;
  if (next === lgTool) return;
  lgTool = next;
  toolListeners.forEach((listener) => listener());
}

export function setLgTool(tool: LgTool) {
  lgEditor?.setCurrentTool(tool);
}

export function undoLg() {
  lgEditor?.undo();
}

export function redoLg() {
  lgEditor?.redo();
}

export function setLgBackground(background: LgBackground) {
  const editor = lgEditor;
  if (!editor) return;
  editor.updateInstanceState({ isGridMode: background === "grid" });
  editor.user.updateUserPreferences({ colorScheme: background === "dark" ? "dark" : "light" });
}

export function focusLgPage(number: number) {
  const document = getActiveDocument(readLgState());
  const page = document && findPage(document, number);
  if (page) lgEditor?.zoomToBounds(pageFocusBounds(page), { inset: FOCUS_INSET, animation: { duration: 300 } });
}

// Homework on the board: one locked image per page, and a locked outline per region.
// Both are kept out of the undo history, so undoing a stroke can't take the homework with it.

const pageShapeId = (number: number) => createShapeId(`lg-page-${number}`);
const regionShapeId = (region_id: string) => createShapeId(`lg-region-${region_id}`);

const isLocked = (shape: TLShape) => shape.meta.kind === "page" || shape.meta.kind === "region";

function lockedShapes(editor: Editor) {
  return editor.getCurrentPageShapes().filter(isLocked);
}

function pageImages(editor: Editor) {
  return editor.getCurrentPageShapes().filter((shape) => shape.meta.kind === "page" && shape.type === "image");
}

function pageAssetId(shape: TLShape | undefined): TLAssetId | null {
  return shape?.type === "image" ? shape.props.assetId : null;
}

// Pages, then region outlines, always sit under everything else, as in tldraw's PDF editor example.
function keepHomeworkAtBottom(editor: Editor) {
  const siblings = editor.getSortedChildIdsForParent(editor.getCurrentPageId());
  const rank = (id: TLShapeId) => {
    const kind = editor.getShape(id)?.meta.kind;
    return kind === "page" ? 0 : kind === "region" ? 1 : 2;
  };
  const homework = siblings.filter((id) => rank(id) < 2).sort((a, b) => rank(a) - rank(b));
  if (homework.every((id, index) => siblings[index] === id)) return;
  const lowestOther = siblings.find((id) => rank(id) === 2);
  const below = lowestOther ? editor.getShape(lowestOther)?.index : undefined;
  const indices = getIndicesBetween(undefined, below, homework.length);
  editor.run(
    () =>
      editor.updateShapes(
        homework.flatMap((id, index) => {
          const shape = editor.getShape(id);
          return shape ? [{ id, type: shape.type, index: indices[index] }] : [];
        }),
      ),
    { history: "ignore", ignoreShapeLock: true },
  );
}

function watchHomeworkShapes(editor: Editor) {
  const stopLock = editor.sideEffects.registerBeforeChangeHandler("shape", (prev, next) =>
    isLocked(prev) && !next.isLocked ? { ...next, isLocked: true } : next,
  );
  const stopCreate = editor.sideEffects.registerAfterCreateHandler("shape", (shape) => {
    if (!isLocked(shape)) keepHomeworkAtBottom(editor);
  });
  const stopReorder = editor.sideEffects.registerAfterChangeHandler("shape", (prev, next) => {
    if (prev.index !== next.index) keepHomeworkAtBottom(editor);
  });
  return () => {
    stopLock();
    stopCreate();
    stopReorder();
  };
}

function regionShape(document: LgDocument, item: LgRegion): TLShapePartial {
  const bounds = regionBounds(document, item);
  return {
    id: regionShapeId(item.region_id),
    type: "geo",
    x: bounds.x,
    y: bounds.y,
    isLocked: true,
    // Regions are data the tutor aims at, never drawn: the outlines stay invisible.
    opacity: 0,
    meta: { kind: "region", region_id: item.region_id },
    props: {
      geo: "rectangle",
      w: bounds.w,
      h: bounds.h,
      color: "grey",
      fill: "none",
      dash: "dashed",
      size: "s",
    },
  };
}

// Redraws the outlines from the document. A whole-page region has none: the page is its outline.
function syncRegionShapes(editor: Editor, document: LgDocument | null) {
  const old = editor.getCurrentPageShapes().filter((shape) => shape.meta.kind === "region");
  const next = (document?.regions ?? []).filter((item) => !item.region_id.endsWith(".page"));
  editor.run(
    () => {
      editor.deleteShapes(old);
      if (document) editor.createShapes(next.map((item) => regionShape(document, item)));
    },
    { history: "ignore", ignoreShapeLock: true },
  );
  keepHomeworkAtBottom(editor);
}

// Removes the pages and outlines, and the page images' stored files, except any still in use.
function removeHomeworkShapes(editor: Editor, keepAssets: TLAssetId[] = []) {
  const shapes = lockedShapes(editor);
  const assets = shapes.flatMap((shape) => pageAssetId(shape) ?? []).filter((id) => !keepAssets.includes(id));
  editor.run(
    () => {
      editor.deleteShapes(shapes);
      if (assets.length) editor.deleteAssets(assets);
    },
    { history: "ignore", ignoreShapeLock: true },
  );
}

// Puts some of the document's pages on the board, in page order, each with its stored image.
function drawPageShapes(editor: Editor, document: LgDocument, numbers: number[], assets: TLAsset[]) {
  const pages = documentPages(document).filter((page) => numbers.includes(page.number));
  const shapes: TLShapePartial[] = pages.map((page, index) => ({
    id: pageShapeId(page.number),
    type: "image",
    x: page.x,
    y: page.y,
    isLocked: true,
    meta: { kind: "page", page: page.number },
    props: { assetId: assets[index].id, w: page.w, h: page.h },
  }));
  editor.run(
    () => {
      editor.createAssets(assets.filter((asset) => !editor.getAsset(asset.id)));
      editor.createShapes(shapes);
    },
    { history: "ignore" },
  );
  syncRegionShapes(editor, document);
}

// Upload progress, kept here rather than in the dialog so it survives the dialog closing.

export type LgUploadState = {
  busy: "opening" | "reading" | null;
  conversation_id: string | null;
  filename: string;
  page: number;
  total: number;
  error: string;
};

const IDLE_UPLOAD: LgUploadState = { busy: null, conversation_id: null, filename: "", page: 0, total: 0, error: "" };
let upload = IDLE_UPLOAD;
let uploadAbort: AbortController | null = null;
const uploadListeners = new Set<() => void>();

function setUpload(patch: Partial<LgUploadState>) {
  upload = { ...upload, ...patch };
  uploadListeners.forEach((listener) => listener());
}

export function getLgUpload(): LgUploadState {
  return upload;
}

export function getIdleLgUpload(): LgUploadState {
  return IDLE_UPLOAD;
}

export function subscribeLgUpload(listener: () => void) {
  uploadListeners.add(listener);
  return () => uploadListeners.delete(listener);
}

// Told when a chat's pages have all been tried, so a live session can hear about the homework.
const readListeners = new Set<(conversation_id: string) => void>();

export function onLgHomeworkRead(listener: (conversation_id: string) => void) {
  readListeners.add(listener);
  return () => {
    readListeners.delete(listener);
  };
}

function homeworkLanguage() {
  const state = readLgState();
  return resolveLanguage(getActiveTutor(state), state.profile);
}

function stopUpload() {
  uploadAbort?.abort();
  uploadAbort = null;
}

// A page waiting to be read: its number on the board, and its own file's hash and page number,
// which key the reading cache.
type PageToRead = { number: number; hash: string; source: number; blob: Blob };

// The images of pages already on the board, to read them (again). A missing one gives its number.
async function storedPages(editor: Editor, document: LgDocument, pages: LgDocumentPage[]): Promise<PageToRead[] | number> {
  const found: PageToRead[] = [];
  for (const page of pages) {
    const url = await editor.resolveAssetUrl(pageAssetId(editor.getShape(pageShapeId(page.number))), {
      shouldResolveToOriginal: true,
    });
    const blob = url ? await fetch(url).then((response) => response.blob()).catch(() => null) : null;
    if (!blob) return page.number;
    const source = pageSource(document, page);
    found.push({ number: page.number, hash: source.hash, source: source.page, blob });
  }
  return found;
}

// Reads the pages one at a time, updating that chat's document as each lands. The pages
// stay usable throughout: a page that isn't read keeps its whole-page region.
async function readPages(conversation_id: string, hash: string, pages: PageToRead[], signal: AbortSignal) {
  const language = homeworkLanguage();
  const update = (change: (document: LgDocument) => LgDocument) => {
    setConversationDocument(conversation_id, (current) => (current && current.hash === hash ? change(current) : current));
    if (lgEditor && lgBoardId === conversation_id) syncRegionShapes(lgEditor, getConversationDocument(readLgState(), conversation_id));
  };
  let failure = "";
  for (const [index, item] of pages.entries()) {
    if (signal.aborted) return;
    setUpload({ busy: "reading", page: index + 1, total: pages.length });
    const outcome = await readHomeworkPage(item.blob, { hash: item.hash, page: item.source, language, signal });
    if (signal.aborted) return;
    if (outcome.ok) {
      const regions = pageRegions(item.number, outcome.reading.problems, outcome.reading.page_text);
      update((document) =>
        // A file removed while it was being read stays removed.
        document.pages.some((page) => page.number === item.number)
          ? {
              ...document,
              pages: document.pages.map((page) => (page.number === item.number ? { ...page, read: "done" } : page)),
              regions: replacePageRegions(document.regions, item.number, regions),
            }
          : document,
      );
      continue;
    }
    failure = outcome.message;
    const failed = outcome.stop ? pages.slice(index).map((page) => page.number) : [item.number];
    update((document) => ({
      ...document,
      pages: document.pages.map((page) => (failed.includes(page.number) ? { ...page, read: "failed" } : page)),
    }));
    if (outcome.stop) break;
  }
  update((document) => ({ ...document, status: "ready" }));
  setUpload({ busy: null, error: failure });
  readListeners.forEach((listener) => listener(conversation_id));
}

// The full upload: check and render the file, put its pages on the board beside any homework
// already open in this chat, then read them.
export async function uploadLgHomework(file: File) {
  stopUpload();
  const editor = lgEditor;
  if (!editor) {
    setUpload({ ...IDLE_UPLOAD, error: "The board isn't ready yet. Try again in a moment." });
    return;
  }
  const abort = new AbortController();
  uploadAbort = abort;
  const boardId = lgBoardId;
  setUpload({ ...IDLE_UPLOAD, busy: "opening", filename: file.name, conversation_id: boardId });

  let opened: Awaited<ReturnType<typeof openHomeworkFile>>;
  let assets: TLAsset[];
  try {
    opened = await openHomeworkFile(file);
    // Stored by tldraw, which keeps the files in this chat's IndexedDB, under its persistenceKey.
    assets = [];
    for (const page of opened.pages) {
      const extension = page.blob.type === "image/png" ? "png" : "jpg";
      const pageFile = new File([page.blob], `page-${page.number}.${extension}`, { type: page.blob.type });
      const asset = await editor.getAssetForExternalContent({ type: "file", file: pageFile });
      if (!asset) throw new LgDocumentError("The pages couldn't be saved on the board. Try again.");
      assets.push(asset);
    }
  } catch (error) {
    if (abort.signal.aborted) return;
    console.error("[lg] upload failed", error);
    const message = error instanceof LgDocumentError ? error.message : "This file couldn't be opened. Try exporting it again.";
    setUpload({ ...IDLE_UPLOAD, error: message });
    return;
  }
  if (abort.signal.aborted) return;
  if (lgEditor !== editor || lgBoardId !== boardId) {
    setUpload({ ...IDLE_UPLOAD, error: "The upload stopped because another chat was opened. Upload it again." });
    return;
  }

  // Homework already open in this chat stays. The new file goes in its own column beside it,
  // and its pages are numbered after the existing ones, so region IDs stay unique.
  const state = readLgState();
  const existing = boardId && state.active_conversation_id === boardId ? getActiveDocument(state) : null;
  const sizes = opened.pages.map((page) => boardPageSize(page.width, page.height));
  const spots = placeNewFile(existing, sizes);
  const firstNumber = existing ? Math.max(0, ...existing.pages.map((page) => page.number)) + 1 : 1;
  const fileId = `file-${crypto.randomUUID().slice(0, 8)}`;
  const added: LgDocumentPage[] = opened.pages.map((page, index) => ({
    number: firstNumber + index,
    ...sizes[index],
    ...spots[index],
    read: "pending",
    file: fileId,
    source: page.number,
  }));
  const files = [
    ...(existing ? documentFiles(existing) : []),
    { id: fileId, filename: file.name, hash: opened.hash, page_count: added.length },
  ];
  const document: LgDocument = {
    filename: fileNames(files),
    page_count: (existing?.pages.length ?? 0) + added.length,
    status: "reading",
    hash: existing?.hash ?? opened.hash,
    files,
    pages: [...(existing?.pages ?? []), ...added],
    regions: [...(existing?.regions ?? []), ...added.map((page) => wholePageRegion(page.number))],
  };
  // Adding homework on the start screen begins the chat, under the same board.
  const conversation_id = setLgDocument(document);
  if (!conversation_id) return;
  if (!existing) removeHomeworkShapes(editor, assets.map((asset) => asset.id));
  drawPageShapes(editor, document, added.map((page) => page.number), assets);
  focusLgPage(firstNumber);

  // Pages of an earlier file that weren't read yet are read along with this one.
  const earlier = existing ? await storedPages(editor, document, existing.pages.filter((page) => page.read !== "done")) : [];
  if (abort.signal.aborted) return;
  const fresh: PageToRead[] = added.map((page, index) => ({
    number: page.number,
    hash: opened.hash,
    source: page.source ?? index + 1,
    blob: opened.pages[index].blob,
  }));
  const toRead = [...(Array.isArray(earlier) ? earlier : []), ...fresh];
  setUpload({ busy: "reading", conversation_id, page: 0, total: toRead.length });
  await readPages(conversation_id, document.hash, toRead, abort.signal);
}

// Reads the open chat's failed pages again, from the page images stored on its board.
export async function retryLgReading() {
  const editor = lgEditor;
  const conversation_id = readLgState().active_conversation_id;
  const document = getActiveDocument(readLgState());
  if (!editor || !conversation_id || !document) return;
  const failed = document.pages.filter((page) => page.read !== "done");
  if (!failed.length) return;
  stopUpload();
  const abort = new AbortController();
  uploadAbort = abort;
  setUpload({ ...IDLE_UPLOAD, busy: "reading", conversation_id, filename: document.filename, total: failed.length });
  const pages = await storedPages(editor, document, failed);
  if (typeof pages === "number") {
    setUpload({ ...IDLE_UPLOAD, error: `Page ${pages} is missing from this browser. Upload the file again.` });
    return;
  }
  if (abort.signal.aborted) return;
  setConversationDocument(conversation_id, (current) => (current ? { ...current, status: "reading" } : current));
  await readPages(conversation_id, document.hash, pages, abort.signal);
}

export function removeLgDocument() {
  if (upload.conversation_id === readLgState().active_conversation_id) {
    stopUpload();
    setUpload(IDLE_UPLOAD);
  }
  setLgDocument(null);
  if (lgEditor) removeHomeworkShapes(lgEditor);
}

// After a reload the board must still hold the pages. Cleared site data, another browser or a
// board saved before real uploads can leave a document without them, so the student is asked
// to upload it again rather than shown marks over empty space.
function forgetMissingHomework(editor: Editor, filename: string) {
  removeHomeworkShapes(editor);
  const conversation_id = readLgState().active_conversation_id;
  if (!conversation_id) return;
  setConversationDocument(conversation_id, () => null);
  appendMessage(
    conversation_id,
    "system",
    `The pages of ${filename || "your homework"} aren't saved in this browser anymore. Upload the file again to keep working on it.`,
  );
}

// The board saves a moment after the chat does, so a reload right after removing or moving a file
// can find the two apart. Pages the homework no longer lists go, so none is left stuck on the
// board. For where pages sit, the board wins, because the marks on them were saved with them.
function reconcileSavedPages(editor: Editor, conversation_id: string, document: LgDocument) {
  const known = new Set(document.pages.map((page) => page.number));
  const strays = pageImages(editor).filter((shape) => !known.has(Number(shape.meta.page)));
  if (strays.length) {
    const assets = strays.flatMap((shape) => pageAssetId(shape) ?? []);
    editor.run(
      () => {
        editor.deleteShapes(strays);
        if (assets.length) editor.deleteAssets(assets);
      },
      { history: "ignore", ignoreShapeLock: true },
    );
  }
  const drifted = documentPages(document).some((page) => {
    const shape = editor.getShape(pageShapeId(page.number));
    return !!shape && (Math.abs(shape.x - page.x) > 0.5 || Math.abs(shape.y - page.y) > 0.5);
  });
  if (!drifted) return;
  setConversationDocument(
    conversation_id,
    (current) =>
      current && {
        ...current,
        pages: current.pages.map((page) => {
          const shape = editor.getShape(pageShapeId(page.number));
          return shape ? { ...page, x: shape.x, y: shape.y } : page;
        }),
      },
  );
}

function checkSavedHomework(editor: Editor) {
  const state = readLgState();
  const conversation = state.conversations.find((item) => item.id === state.active_conversation_id);
  const document = getActiveDocument(state);
  if (!document) {
    // A document saved in the old placeholder format, or pages left with no document.
    if (conversation?.document) forgetMissingHomework(editor, conversation.document.filename);
    else if (lockedShapes(editor).length) removeHomeworkShapes(editor);
    return;
  }
  if (conversation) reconcileSavedPages(editor, conversation.id, document);
  const images = pageImages(editor);
  const assetIds = images.map(pageAssetId);
  if (images.length < document.pages.length || assetIds.some((id) => !id || !editor.getAsset(id))) {
    forgetMissingHomework(editor, document.filename);
    return;
  }
  // Reading stopped by a reload: the pages it didn't reach can be read again from the dialog.
  if (document.status === "reading" && upload.conversation_id !== conversation?.id) {
    setConversationDocument(conversation!.id, (current) =>
      current && {
        ...current,
        status: "ready",
        pages: current.pages.map((page) => (page.read === "pending" ? { ...page, read: "failed" } : page)),
      },
    );
  }
  syncRegionShapes(editor, getActiveDocument(readLgState()));
  // The records can outlive the stored files, so the first page's file is checked too.
  void editor.resolveAssetUrl(assetIds[0], { shouldResolveToOriginal: true }).then((url) => {
    if (!url && lgEditor === editor) forgetMissingHomework(editor, document.filename);
  });
}

// Files on the board: where each sits on screen, which one is selected, and moving or removing
// one. The pages stay locked in tldraw, so its own tools never move them. Only these functions do,
// taking the region outlines and every mark on the file along, and saving where the pages end up,
// so the tutor's marks, Check my work and region positions stay right.

export type LgBoardFile = {
  id: string;
  filename: string;
  pageCount: number;
  // On screen, relative to the board.
  x: number;
  y: number;
  w: number;
  h: number;
};

const NO_FILES: LgBoardFile[] = [];
let boardFiles: LgBoardFile[] = NO_FILES;
let selectedFile: string | null = null;
const fileListeners = new Set<() => void>();

function notifyFiles() {
  fileListeners.forEach((listener) => listener());
}

export function getLgFiles(): LgBoardFile[] {
  return boardFiles;
}

export function getNoLgFiles(): LgBoardFile[] {
  return NO_FILES;
}

export function getLgSelectedFile(): string | null {
  return selectedFile;
}

export function subscribeLgFiles(listener: () => void) {
  fileListeners.add(listener);
  return () => {
    fileListeners.delete(listener);
  };
}

export function selectLgFile(id: string | null) {
  if (id === selectedFile) return;
  selectedFile = id;
  notifyFiles();
}

// The homework of the board that's open.
function boardDocument(): LgDocument | null {
  return lgBoardId ? getConversationDocument(readLgState(), lgBoardId) : null;
}

function filePageNumbers(document: LgDocument, fileId: string): number[] {
  return document.pages.filter((page) => fileOfPage(page) === fileId).map((page) => page.number);
}

function pageShapeBounds(editor: Editor, numbers: number[]): Box[] {
  return numbers.flatMap((number) => {
    const shape = editor.getShape(pageShapeId(number));
    const bounds = shape && editor.getShapePageBounds(shape);
    return bounds ? [bounds] : [];
  });
}

// A file's pages, its region outlines, and every mark whose centre is on one of its pages or in
// their margins, where the tutor writes notes.
function attachedShapes(editor: Editor, document: LgDocument, numbers: number[]): TLShape[] {
  const areas = pageShapeBounds(editor, numbers).map((bounds) =>
    Box.From(pageFocusBounds({ number: 0, x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h })),
  );
  return editor.getCurrentPageShapes().filter((shape) => {
    if (shape.meta.kind === "page") return numbers.includes(Number(shape.meta.page));
    if (shape.meta.kind === "region") return numbers.includes(findRegion(document, String(shape.meta.region_id))?.page ?? -1);
    const bounds = editor.getShapePageBounds(shape);
    return !!bounds && areas.some((area) => area.containsPoint(bounds.center));
  });
}

function fileAt(editor: Editor, point: { x: number; y: number }): string | null {
  const document = boardDocument();
  const page = document?.pages.find((item) => pageShapeBounds(editor, [item.number])[0]?.containsPoint(point));
  return page ? fileOfPage(page) : null;
}

function computeBoardFiles(editor: Editor): LgBoardFile[] {
  const document = boardDocument();
  if (!document) return NO_FILES;
  return documentFiles(document).flatMap((file) => {
    const boxes = pageShapeBounds(editor, filePageNumbers(document, file.id));
    if (!boxes.length) return [];
    const box = Box.Common(boxes);
    const topLeft = editor.pageToViewport({ x: box.minX, y: box.minY });
    const bottomRight = editor.pageToViewport({ x: box.maxX, y: box.maxY });
    return [
      {
        id: file.id,
        filename: file.filename,
        pageCount: boxes.length,
        x: topLeft.x,
        y: topLeft.y,
        w: bottomRight.x - topLeft.x,
        h: bottomRight.y - topLeft.y,
      },
    ];
  });
}

function sameFiles(a: LgBoardFile[], b: LgBoardFile[]) {
  const close = (one: number, two: number) => Math.abs(one - two) < 0.5;
  return (
    a.length === b.length &&
    a.every((file, index) => {
      const other = b[index];
      return (
        other.id === file.id &&
        other.filename === file.filename &&
        other.pageCount === file.pageCount &&
        close(other.x, file.x) &&
        close(other.y, file.y) &&
        close(other.w, file.w) &&
        close(other.h, file.h)
      );
    })
  );
}

// Keeps the files' screen positions current as the board pans, zooms and changes.
function watchBoardFiles(editor: Editor) {
  const refresh = () => {
    const next = computeBoardFiles(editor);
    const keepSelection = !selectedFile || next.some((file) => file.id === selectedFile);
    if (sameFiles(next, boardFiles) && keepSelection) return;
    boardFiles = next;
    if (!keepSelection) selectedFile = null;
    notifyFiles();
  };
  const stopFollowingBoard = react("lg board files", () => {
    // Read first, so panning, zooming and shape changes always rerun this, even while the chat
    // has no homework and refresh returns early.
    editor.getCamera();
    editor.getCurrentPageShapes();
    refresh();
  });
  const stopFollowingState = subscribeLgState(refresh);
  return () => {
    stopFollowingBoard();
    stopFollowingState();
    boardFiles = NO_FILES;
    selectedFile = null;
    notifyFiles();
  };
}

// With the select tool, clicking a file selects it. tldraw ignores the locked pages, so a click
// on one reaches here with nothing selected; a student mark it did select wins over the file.
function watchFileClicks(editor: Editor) {
  let downAt: { x: number; y: number } | null = null;
  const onEvent = (info: TLEventInfo) => {
    if (info.type !== "pointer") return;
    if (info.name === "pointer_down") {
      downAt = { x: info.point.x, y: info.point.y };
      return;
    }
    if (info.name !== "pointer_up" || !downAt) return;
    const moved = Math.hypot(info.point.x - downAt.x, info.point.y - downAt.y);
    downAt = null;
    if (editor.getCurrentToolId() !== "select" || moved > 4) return;
    const point = editor.inputs.getCurrentPagePoint();
    queueMicrotask(() => {
      selectLgFile(editor.getSelectedShapeIds().length ? null : fileAt(editor, point));
    });
  };
  editor.on("event", onEvent);
  const stopFollowingTool = react("lg file selection tool", () => {
    if (editor.getCurrentToolId() !== "select") selectLgFile(null);
  });
  return () => {
    editor.off("event", onEvent);
    stopFollowingTool();
  };
}

let movingFile: string | null = null;
let movingShapes: TLShapeId[] = [];

export function startLgFileMove(fileId: string) {
  const editor = lgEditor;
  const document = boardDocument();
  if (!editor || !document) return;
  movingFile = fileId;
  movingShapes = attachedShapes(editor, document, filePageNumbers(document, fileId)).map((shape) => shape.id);
}

// Moves the file being dragged by a distance in screen pixels.
export function moveLgFileBy(dx: number, dy: number) {
  const editor = lgEditor;
  if (!editor || !movingShapes.length) return;
  const zoom = editor.getZoomLevel();
  const updates: TLShapePartial[] = movingShapes.flatMap((id) => {
    const shape = editor.getShape(id);
    return shape ? [{ id, type: shape.type, x: shape.x + dx / zoom, y: shape.y + dy / zoom }] : [];
  });
  editor.run(() => editor.updateShapes(updates), { history: "ignore", ignoreShapeLock: true });
}

// Saves where the file's pages ended up, so everything placed from the document follows.
export function endLgFileMove() {
  const editor = lgEditor;
  const conversation_id = lgBoardId;
  const fileId = movingFile;
  movingFile = null;
  movingShapes = [];
  if (!editor || !conversation_id || !fileId) return;
  setConversationDocument(
    conversation_id,
    (current) =>
      current && {
        ...current,
        pages: current.pages.map((page) => {
          if (fileOfPage(page) !== fileId) return page;
          const shape = editor.getShape(pageShapeId(page.number));
          return shape ? { ...page, x: shape.x, y: shape.y } : page;
        }),
      },
  );
  syncRegionShapes(editor, boardDocument());
}

// Removes one file: its pages and outlines, the tutor's marks on it and the spots circled on it.
// The student's own marks stay. The last file removes the homework altogether.
export function removeLgFile(fileId: string) {
  const editor = lgEditor;
  const conversation_id = lgBoardId;
  const document = boardDocument();
  if (!editor || !conversation_id || !document) return;
  selectLgFile(null);
  if (documentFiles(document).length <= 1) {
    removeLgDocument();
    return;
  }
  const numbers = filePageNumbers(document, fileId);
  const shapes = attachedShapes(editor, document, numbers).filter((shape) => shape.meta.kind || shape.meta.author === "tutor");
  const assets = shapes.flatMap((shape) => (shape.meta.kind === "page" ? (pageAssetId(shape) ?? []) : []));
  const circled = shapes.flatMap((shape) => (shape.meta.kind === "selection" ? String(shape.meta.selection_id) : []));
  editor.run(
    () => {
      editor.deleteShapes(shapes);
      if (assets.length) editor.deleteAssets(assets);
    },
    { history: "ignore", ignoreShapeLock: true },
  );
  removeBoardSelections(conversation_id, circled);
  setConversationDocument(conversation_id, (current) => {
    if (!current) return current;
    const files = documentFiles(current).filter((file) => file.id !== fileId);
    const pages = current.pages.filter((page) => !numbers.includes(page.number));
    return {
      ...current,
      files,
      filename: fileNames(files),
      page_count: pages.length,
      pages,
      regions: current.regions.filter((item) => !numbers.includes(item.page)),
    };
  });
  syncRegionShapes(editor, boardDocument());
  // A live session hears the region list that's left.
  readListeners.forEach((listener) => listener(conversation_id));
}

// The student's first stroke on the start screen begins a chat. Pages and tutor marks carry
// a meta tag and only appear once a chat has begun, so they never trigger this.
function startChatOnFirstMark(editor: Editor) {
  return editor.store.listen(
    ({ changes }) => {
      if (readLgState().active_conversation_id) return;
      const marked = Object.values(changes.added).some(
        (record) => record.typeName === "shape" && !record.meta.kind && !record.meta.author,
      );
      if (marked) startConversation();
    },
    { source: "user", scope: "document" },
  );
}

export function bindLearningGrounds(editor: Editor, boardId: string) {
  lgEditor = editor;
  lgBoardId = boardId;
  checkSavedHomework(editor);
  // The board saves a moment after the chat, so it can hold a loop the chat no longer lists.
  pruneSelectionLoops(editor, boardId);
  setLgBackground("plain");
  editor.setCurrentTool("draw");
  focusLgPage(1);
  const unlink = linkLgBoard(editor);
  const detachPen = attachPen(editor);
  const stopWatchingHomework = watchHomeworkShapes(editor);
  const stopWatchingTool = react("lg current tool", () => setToolFromEditor(editor));
  const stopWatchingMarks = startChatOnFirstMark(editor);
  const stopWatchingFiles = watchBoardFiles(editor);
  const stopWatchingClicks = watchFileClicks(editor);
  const stopWatchingAnswers = watchAnswers(editor);
  return () => {
    // First, so a mark still being drawn is finished and saved with this chat's board.
    detachPen();
    unlink();
    stopWatchingHomework();
    stopWatchingTool();
    stopWatchingMarks();
    stopWatchingFiles();
    stopWatchingClicks();
    stopWatchingAnswers();
    if (lgEditor === editor) {
      lgEditor = null;
      lgBoardId = null;
    }
  };
}
