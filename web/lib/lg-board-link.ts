"use client";

import { useSyncExternalStore } from "react";
import { Box, type Editor, type TLShape } from "tldraw";
import { findRegion, regionFocusBounds, regionWorkBounds, type LgBounds } from "./lg-regions";
import { getActiveDocument, readLgState, subscribeLgState } from "./lg-store";

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

export function noteLgActionTarget(action: { region_id?: string; near_region_id?: string }) {
  const region_id = action.region_id ?? action.near_region_id;
  if (region_id) setLgFocusRegion(region_id);
}

function contains(area: LgBounds, x: number, y: number) {
  return x >= area.x && x <= area.x + area.w && y >= area.y && y <= area.y + area.h;
}

function regionAt(x: number, y: number) {
  const document = getActiveDocument(readLgState());
  return document?.regions.find((item) => contains(regionFocusBounds(document, item), x, y));
}

// Connects the back end to an open board. Returns the function that disconnects it.
export function linkLgBoard(editor: Editor) {
  linkedEditor = editor;
  const stopFollowingPen = editor.store.listen(
    ({ changes }) => {
      for (const record of Object.values(changes.added)) {
        if (record.typeName !== "shape" || record.meta.author === "tutor" || record.meta.kind) continue;
        const item = regionAt(record.x, record.y);
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

const isStudentMark = (shape: TLShape) => !shape.meta.kind && shape.meta.author !== "tutor";

// A picture of the student's work on a region: their marks and the homework page under them,
// cropped to the region's working area, without the tutor's marks. With no homework open, it's
// all of the student's marks on the board, and region_id is ignored.
export async function captureLgRegion(region_id: string): Promise<LgRegionCapture> {
  const editor = linkedEditor;
  if (!editor) return "no_board";
  const document = getActiveDocument(readLgState());
  const shapes = editor.getCurrentPageShapes();

  let include: TLShape[];
  let bounds: Box;
  // The working area already frames the problem, and wider padding would show the next one.
  const padding = document ? 8 : 16;
  if (document) {
    const item = findRegion(document, region_id);
    if (!item) return "unknown_region";
    const area = Box.From(regionWorkBounds(document, item));
    const overlapsArea = (shape: TLShape) => {
      const box = editor.getShapePageBounds(shape);
      return !!box && box.minX <= area.maxX && box.maxX >= area.minX && box.minY <= area.maxY && box.maxY >= area.minY;
    };
    const work = shapes.filter((shape) => isStudentMark(shape) && overlapsArea(shape));
    if (!work.some((shape) => shape.type !== "image")) return "no_work";
    // The page images are included whole and cropped by the export bounds.
    const pages = shapes.filter((shape) => shape.meta.kind === "page" && overlapsArea(shape));
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
