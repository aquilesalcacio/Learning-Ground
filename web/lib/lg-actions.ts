"use client";

import {
  createShapeId,
  DefaultColorStyle,
  type Editor,
  react,
  type TLShapePartial,
  toRichText,
} from "tldraw";
import {
  findRegion,
  LG_PAGES,
  LG_REGIONS,
  MARGIN_WIDTH,
  pageFocusBounds,
  regionBounds,
  regionFocusBounds,
  regionMarginX,
} from "./lg-regions";
import { getActiveDocument, getActiveTutor, readLgState, setLgDocument, startConversation } from "./lg-store";
import type { LgBackground, LgDocument, PenColor } from "./lg-types";

// The seam between the board and the voice session (vision doc, section 8.1).
// Voice client tools and the test buttons both call applyLgAction and nothing else.
export type LgAction =
  | { type: "focus_region"; region_id: string }
  | { type: "circle_region"; region_id: string }
  | { type: "draw_arrow"; from_region_id: string; to_region_id: string; label?: string }
  | { type: "write_text"; near_region_id: string; text: string }
  | { type: "write_math"; near_region_id: string; latex: string }
  | { type: "clear" };

const CIRCLE_PADDING = 12;
const MARGIN_LINE_GAP = 12;
const ARROW_BEND = 40;
const FOCUS_INSET = 24;

let lgEditor: Editor | null = null;

// Padding that lets an oval enclose a rectangle's corners, so its label isn't cut through.
function ovalPadding(w: number, h: number) {
  const short = Math.min(w, h);
  const radius = short / 2 + CIRCLE_PADDING;
  const along = radius - Math.sqrt(radius * radius - (short / 2) ** 2);
  return w >= h ? { x: along, y: CIRCLE_PADDING } : { x: CIRCLE_PADDING, y: along };
}

function tutorMeta(near?: string) {
  return near ? { author: "tutor", near } : { author: "tutor" };
}

function tutorColor() {
  return getActiveTutor(readLgState()).color;
}

function writeNear(editor: Editor, region_id: string, text: string, font: "draw" | "mono") {
  const item = findRegion(region_id);
  if (!item) return;
  // Stack below earlier notes on this region, measured so wrapped text never overlaps.
  const y = editor
    .getCurrentPageShapes()
    .filter((shape) => shape.meta.author === "tutor" && shape.meta.near === region_id)
    .reduce(
      (next, shape) => Math.max(next, (editor.getShapePageBounds(shape)?.maxY ?? 0) + MARGIN_LINE_GAP),
      regionBounds(item).y,
    );
  editor.createShape({
    id: createShapeId(),
    type: "text",
    x: regionMarginX(item),
    y,
    meta: tutorMeta(region_id),
    props: {
      richText: toRichText(text),
      color: tutorColor(),
      size: "s",
      font,
      autoSize: false,
      w: MARGIN_WIDTH,
    },
  });
}

export function applyLgAction(action: LgAction) {
  const editor = lgEditor;
  if (!editor) {
    console.warn("[lg] No board is open, so this action did nothing:", action);
    return;
  }
  // Regions live on the homework pages. Without any, the tutor would mark empty space.
  if (action.type !== "clear" && !getActiveDocument(readLgState())) {
    console.warn("[lg] No homework is open, so this action did nothing:", action);
    return;
  }

  switch (action.type) {
    case "focus_region": {
      const item = findRegion(action.region_id);
      if (!item) return;
      editor.zoomToBounds(regionFocusBounds(item), { inset: FOCUS_INSET, animation: { duration: 300 } });
      return;
    }
    case "circle_region": {
      const item = findRegion(action.region_id);
      if (!item) return;
      const bounds = regionBounds(item);
      const padding = ovalPadding(bounds.w, bounds.h);
      editor.createShape({
        id: createShapeId(),
        type: "geo",
        x: bounds.x - padding.x,
        y: bounds.y - padding.y,
        meta: tutorMeta(),
        props: {
          geo: "oval",
          w: bounds.w + padding.x * 2,
          h: bounds.h + padding.y * 2,
          color: tutorColor(),
          fill: "none",
          dash: "draw",
        },
      });
      return;
    }
    case "draw_arrow": {
      const from = findRegion(action.from_region_id);
      const to = findRegion(action.to_region_id);
      if (!from || !to) return;
      const start = regionBounds(from);
      const end = regionBounds(to);
      const startY = start.y + start.h / 2;
      const endY = end.y + end.h / 2;
      // Arcs out through the left gutter. Bend is relative to travel, so it flips going up.
      editor.createShape({
        id: createShapeId(),
        type: "arrow",
        x: 0,
        y: 0,
        meta: tutorMeta(),
        props: {
          color: tutorColor(),
          start: { x: start.x, y: startY },
          end: { x: end.x, y: endY },
          bend: endY >= startY ? ARROW_BEND : -ARROW_BEND,
          richText: toRichText(action.label ?? ""),
        },
      });
      return;
    }
    case "write_text":
      writeNear(editor, action.near_region_id, action.text, "draw");
      return;
    case "write_math":
      // Mocked: shows the raw LaTeX until the KaTeX rendering is built.
      writeNear(editor, action.near_region_id, action.latex, "mono");
      return;
    case "clear": {
      const marks = editor.getCurrentPageShapes().filter((shape) => shape.meta.author === "tutor");
      editor.deleteShapes(marks);
      return;
    }
  }
}

export function setLgRegionsVisible(visible: boolean) {
  const editor = lgEditor;
  if (!editor) return;
  const updates: TLShapePartial[] = editor
    .getCurrentPageShapes()
    .filter((shape) => shape.meta.kind === "region")
    .map((shape) => ({ id: shape.id, type: shape.type, opacity: visible ? 1 : 0 }));
  editor.run(() => editor.updateShapes(updates), { ignoreShapeLock: true });
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
export const LG_TOOLS = ["select", "hand", "draw", "eraser", "text", "arrow", "laser"] as const;
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
  const page = LG_PAGES.find((item) => item.number === number);
  if (page && getActiveDocument(readLgState())) lgEditor?.zoomToBounds(pageFocusBounds(page), { inset: FOCUS_INSET, animation: { duration: 300 } });
}

function lockedShapes(editor: Editor) {
  return editor.getCurrentPageShapes().filter((shape) => shape.meta.kind === "page" || shape.meta.kind === "region");
}

function drawLockedPages(editor: Editor, filename: string) {
  const pageShapes: TLShapePartial[] = LG_PAGES.map((page) => ({
    id: createShapeId(`lg-page-${page.number}`),
    type: "geo",
    x: page.x,
    y: page.y,
    isLocked: true,
    meta: { kind: "page" },
    props: {
      geo: "rectangle",
      w: page.w,
      h: page.h,
      color: "grey",
      labelColor: "grey",
      fill: "none",
      dash: "solid",
      size: "s",
      font: "sans",
      align: "start",
      verticalAlign: "start",
      richText: toRichText(`Page ${page.number}: ${filename} (placeholder)`),
    },
  }));

  const regionShapes: TLShapePartial[] = LG_REGIONS.map((item) => {
    const bounds = regionBounds(item);
    return {
      id: createShapeId(`lg-region-${item.region_id}`),
      type: "geo",
      x: bounds.x,
      y: bounds.y,
      isLocked: true,
      meta: { kind: "region", region_id: item.region_id },
      props: {
        geo: "rectangle",
        w: bounds.w,
        h: bounds.h,
        color: "grey",
        labelColor: "grey",
        fill: "none",
        dash: "dashed",
        size: "s",
        font: "sans",
        align: "start",
        verticalAlign: "start",
        richText: toRichText(item.label),
      },
    };
  });

  // Kept out of the undo history, so undoing a stroke can't take the homework with it.
  editor.run(() => editor.createShapes([...pageShapes, ...regionShapes]), { history: "ignore" });
}

function removeLockedPages(editor: Editor) {
  const shapes = lockedShapes(editor);
  editor.run(() => editor.deleteShapes(shapes), { history: "ignore", ignoreShapeLock: true });
}

export function showLgDocument(document: LgDocument) {
  setLgDocument(document);
  const editor = lgEditor;
  if (!editor) return;
  removeLockedPages(editor);
  drawLockedPages(editor, document.filename);
  focusLgPage(1);
}

export function removeLgDocument() {
  setLgDocument(null);
  if (lgEditor) removeLockedPages(lgEditor);
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

export function bindLearningGrounds(editor: Editor) {
  lgEditor = editor;
  // A saved board already has its pages, so they are only drawn if they are missing.
  const document = getActiveDocument(readLgState());
  if (document && lockedShapes(editor).length === 0) drawLockedPages(editor, document.filename);
  setLgBackground("plain");
  editor.setCurrentTool("draw");
  focusLgPage(1);
  const stopWatchingTool = react("lg current tool", () => setToolFromEditor(editor));
  const stopWatchingMarks = startChatOnFirstMark(editor);
  return () => {
    stopWatchingTool();
    stopWatchingMarks();
    if (lgEditor === editor) lgEditor = null;
  };
}
