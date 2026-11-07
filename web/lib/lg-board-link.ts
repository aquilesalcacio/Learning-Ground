"use client";

import { useSyncExternalStore } from "react";
import { Box, type Editor, type TLShape } from "tldraw";
import { findRegion, LG_REGIONS, regionBounds, regionFocusBounds } from "./lg-regions";

// What the back end needs from the board, kept apart from lg-actions.ts so UI work there stays simple.
// lg-actions.ts calls linkLgBoard when a board opens and noteLgActionTarget for each action.

let linkedEditor: Editor | null = null;

// The region being worked on: Check my work reads this one.
let focusRegionId = LG_REGIONS[0].region_id;
const focusListeners = new Set<() => void>();

function subscribeLgFocusRegion(listener: () => void) {
  focusListeners.add(listener);
  return () => focusListeners.delete(listener);
}

export function useLgFocusRegion() {
  return useSyncExternalStore(
    subscribeLgFocusRegion,
    () => focusRegionId,
    () => LG_REGIONS[0].region_id,
  );
}

function setLgFocusRegion(region_id: string) {
  if (region_id === focusRegionId || !findRegion(region_id)) return;
  focusRegionId = region_id;
  focusListeners.forEach((listener) => listener());
}

export function noteLgActionTarget(action: { region_id?: string; near_region_id?: string }) {
  const region_id = action.region_id ?? action.near_region_id;
  if (region_id) setLgFocusRegion(region_id);
}

function regionAt(x: number, y: number) {
  return LG_REGIONS.find((item) => {
    const area = regionFocusBounds(item);
    return x >= area.x && x <= area.x + area.w && y >= area.y && y <= area.y + area.h;
  });
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

// A picture of the student's work on a region: their marks and any page image, without the tutor's marks.
export async function captureLgRegion(region_id: string): Promise<LgRegionCapture> {
  const editor = linkedEditor;
  if (!editor) return "no_board";
  const item = findRegion(region_id);
  if (!item) return "unknown_region";

  const area = regionFocusBounds(item);
  const overlapsArea = (shape: TLShape) => {
    const bounds = editor.getShapePageBounds(shape);
    return (
      !!bounds &&
      bounds.minX <= area.x + area.w &&
      bounds.maxX >= area.x &&
      bounds.minY <= area.y + area.h &&
      bounds.maxY >= area.y
    );
  };
  const shapes = editor.getCurrentPageShapes();
  const work = shapes.filter((shape) => !shape.meta.kind && shape.meta.author !== "tutor" && overlapsArea(shape));
  if (!work.some((shape) => shape.type !== "image")) return "no_work";

  const regionShape = shapes.filter((shape) => shape.meta.kind === "region" && shape.meta.region_id === region_id);
  const boxes = work.flatMap((shape) => editor.getShapePageBounds(shape) ?? []);
  const { blob } = await editor.toImage([...regionShape, ...work], {
    format: "png",
    bounds: Box.Common([Box.From(regionBounds(item)), ...boxes]),
    background: true,
    // Always light, so a dark board still gives Gemini dark writing on white.
    darkMode: false,
    padding: 16,
    pixelRatio: 2,
  });
  return blob;
}
