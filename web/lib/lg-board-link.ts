"use client";

import { useSyncExternalStore } from "react";
import { Box, type Editor, type TLShape } from "tldraw";
import { findRegion, regionAt, regionWorkBounds, type LgBounds } from "./lg-regions";
import { selectionArea } from "./lg-selection";
import { findBoardQuestion, findBoardSelection, getActiveDocument, readLgState, subscribeLgState } from "./lg-store";

// What the back end needs from the board, kept apart from lg-actions.ts so UI work there stays simple.
// lg-actions.ts calls linkLgBoard when a board opens and noteLgActionTarget for each action.

let linkedEditor: Editor | null = null;

// The region being worked on: Check my work reads this one. It falls back to the open
// homework's first region, and is "" when no homework is open.
let focusRegionId = "";
const focusListeners = new Set<() => void>();

function subscribeLgFocusRegion(listener: () => void) {
  focusListeners.add(listener);
  const unsubscribeState = subscribeLgState(listener);
  return () => {
    focusListeners.delete(listener);
    unsubscribeState();
  };
}

export function getLgFocusRegion(): string {
  const document = getActiveDocument(readLgState());
  if (findRegion(document, focusRegionId)) return focusRegionId;
  return document?.regions[0]?.region_id ?? "";
}

export function useLgFocusRegion() {
  return useSyncExternalStore(subscribeLgFocusRegion, getLgFocusRegion, () => "");
}

function setLgFocusRegion(region_id: string) {
  if (region_id === focusRegionId || !findRegion(getActiveDocument(readLgState()), region_id)) return;
  focusRegionId = region_id;
  focusListeners.forEach((listener) => listener());
}

// A spot the student circled (s1) stands for the region it was drawn on.
export function noteLgActionTarget(action: { region_id?: string; near_region_id?: string }) {
  const id = action.region_id ?? action.near_region_id;
  const region_id = id && /^s\d+$/.test(id) ? findBoardSelection(readLgState(), id)?.region_id : id;
  if (region_id) setLgFocusRegion(region_id);
}

// Connects the back end to an open board. Returns the function that disconnects it.
export function linkLgBoard(editor: Editor) {
  linkedEditor = editor;
  const stopFollowingPen = editor.store.listen(
    ({ changes }) => {
      for (const record of Object.values(changes.added)) {
        if (record.typeName !== "shape" || record.meta.author === "tutor" || record.meta.kind) continue;
        const item = regionAt(getActiveDocument(readLgState()), record);
        if (item) setLgFocusRegion(item.region_id);
      }
    },
    { source: "user", scope: "document" },
  );
  return () => {
    stopFollowingPen();
    if (linkedEditor === editor) linkedEditor = null;
  };
}

export type LgRegionCapture = Blob | "no_board" | "unknown_region" | "no_work";

// The API refuses snapshots over 5 MB. A photographed page can pass that at 2x, so it steps down.
const MAX_CAPTURE_BYTES = 4.5 * 1024 * 1024;
const PIXEL_RATIOS = [2, 1.5, 1];

// What the student put on the board themselves: not the tutor's marks, the pages, outlines,
// questions or circled spots. Checks capture these, and mark_work goes beside them.
export const isStudentMark = (shape: TLShape) => !shape.meta.kind && shape.meta.author !== "tutor";

// Where a spot the student circled (s1) is now: its loop on the board, which moves with its file,
// or where it was saved when the loop is gone. Null when there's no such spot.
export function lgSelectionBounds(id: string): LgBounds | null {
  const selection = findBoardSelection(readLgState(), id);
  if (!selection) return null;
  const editor = linkedEditor;
  const loop = editor
    ?.getCurrentPageShapes()
    .find((shape) => shape.meta.kind === "selection" && shape.meta.selection_id === id);
  const live = loop && editor?.getShapePageBounds(loop);
  return selectionArea(live ? { x: live.x, y: live.y, w: live.w, h: live.h } : selection.bounds);
}

// Whether a shape reaches into an area, even partly.
function reaches(editor: Editor, shape: TLShape, area: Box) {
  const box = editor.getShapePageBounds(shape);
  return !!box && box.minX <= area.maxX && box.maxX >= area.minX && box.minY <= area.maxY && box.maxY >= area.minY;
}

const marksIn = (editor: Editor, shapes: TLShape[], area: Box) =>
  shapes.filter((shape) => isStudentMark(shape) && reaches(editor, shape, area));
const pagesIn = (editor: Editor, shapes: TLShape[], area: Box) =>
  shapes.filter((shape) => shape.meta.kind === "page" && reaches(editor, shape, area));

// Whether any of the student's own writing is inside a spot they circled, so the tutor knows to
// check it rather than explain the printed problem.
export function lgSelectionHasWork(id: string): boolean {
  const editor = linkedEditor;
  const bounds = lgSelectionBounds(id);
  if (!editor || !bounds) return false;
  return marksIn(editor, editor.getCurrentPageShapes(), Box.From(bounds)).some((shape) => shape.type !== "image");
}

// A picture of the student's work on a region: their marks and the homework page under them,
// cropped to the region's working area, without the tutor's marks. For a question the tutor wrote
// on the board (q1), it's the question's note and what the student wrote in or by its answer box.
// For a spot the student circled (s1), it's just what's inside the loop: the page and their marks
// there, without the loop itself. With no homework open and no such question or spot, it's all
// of the student's marks on the board.
export async function captureLgRegion(region_id: string): Promise<LgRegionCapture> {
  const editor = linkedEditor;
  if (!editor) return "no_board";
  const state = readLgState();
  const document = getActiveDocument(state);
  const question = findBoardQuestion(state, region_id);
  const selected = lgSelectionBounds(region_id);
  const shapes = editor.getCurrentPageShapes();

  let include: TLShape[];
  let bounds: Box;
  // The working area already frames the problem, and wider padding would show the next one.
  let padding = document ? 8 : 16;
  if (selected) {
    // Cropped to the loop, so the verdict is on just that part. The page is cropped by the bounds.
    const area = Box.From(selected);
    const work = marksIn(editor, shapes, area);
    if (!work.some((shape) => shape.type !== "image")) return "no_work";
    include = [...pagesIn(editor, shapes, area), ...work];
    bounds = area;
    padding = 8;
  } else if (question) {
    // The note shows the question being answered. The student may write a little outside the box.
    const area = Box.From(question.answer).expandBy(24);
    const overlapsArea = (shape: TLShape) => !!editor.getShapePageBounds(shape)?.collides(area);
    const work = shapes.filter((shape) => isStudentMark(shape) && overlapsArea(shape));
    if (!work.some((shape) => shape.type !== "image")) return "no_work";
    const note = shapes.filter((shape) => shape.meta.question === question.id && shape.type === "note");
    include = [...note, ...work];
    bounds = Box.Common([Box.From(question.card), area, ...work.flatMap((shape) => editor.getShapePageBounds(shape) ?? [])]);
    padding = 16;
  } else if (document) {
    const item = findRegion(document, region_id);
    if (!item) return "unknown_region";
    const area = Box.From(regionWorkBounds(document, item));
    const work = marksIn(editor, shapes, area);
    if (!work.some((shape) => shape.type !== "image")) return "no_work";
    // The page images are included whole and cropped by the export bounds.
    const pages = pagesIn(editor, shapes, area);
    const outline = shapes.filter((shape) => shape.meta.kind === "region" && shape.meta.region_id === region_id);
    include = [...pages, ...outline, ...work];
    bounds = Box.Common([area, ...work.flatMap((shape) => editor.getShapePageBounds(shape) ?? [])]);
  } else {
    const work = shapes.filter(isStudentMark);
    if (!work.some((shape) => shape.type !== "image")) return "no_work";
    include = work;
    bounds = Box.Common(work.flatMap((shape) => editor.getShapePageBounds(shape) ?? []));
  }

  let blob: Blob | null = null;
  for (const pixelRatio of PIXEL_RATIOS) {
    ({ blob } = await editor.toImage(include, {
      format: "png",
      bounds,
      background: true,
      // Always light, so a dark board still gives Gemini dark writing on white.
      darkMode: false,
      padding,
      pixelRatio,
    }));
    if (blob.size <= MAX_CAPTURE_BYTES) break;
  }
  return blob as Blob;
}
