"use client";

import {
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
import { linkLgBoard, noteLgActionTarget } from "./lg-board-link";
import {
  boardPageSize,
  documentFiles,
  documentPages,
  fileNames,
  fileOfPage,
  findPage,
  findRegion,
  MARGIN_WIDTH,
  pageFocusBounds,
  pageRegions,
  pageSource,
  placeNewFile,
  regionBounds,
  regionFocusBounds,
  regionMarginX,
  replacePageRegions,
  wholePageRegion,
} from "./lg-regions";
import { LgDocumentError, openHomeworkFile, readHomeworkPage } from "./lg-document";
import {
  appendMessage,
  getActiveDocument,
  getActiveTutor,
  getConversationDocument,
  readLgState,
  setConversationDocument,
  setLgDocument,
  startConversation,
  subscribeLgState,
} from "./lg-store";
import { resolveLanguage } from "./lg-tutor-prompt";
import type { LgBackground, LgDocument, LgDocumentPage, LgRegion, PenColor } from "./lg-types";

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
// The chat whose board is open: its ID, or the draft ID on the start screen.
let lgBoardId: string | null = null;

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

function writeNear(editor: Editor, document: LgDocument, region_id: string, text: string, font: "draw" | "mono") {
  const item = findRegion(document, region_id);
  if (!item) return;
  // Stack below earlier notes on this region, measured so wrapped text never overlaps.
  const y = editor
    .getCurrentPageShapes()
    .filter((shape) => shape.meta.author === "tutor" && shape.meta.near === region_id)
    .reduce(
      (next, shape) => Math.max(next, (editor.getShapePageBounds(shape)?.maxY ?? 0) + MARGIN_LINE_GAP),
      regionBounds(document, item).y,
    );
  editor.createShape({
    id: createShapeId(),
    type: "text",
    x: regionMarginX(document, item),
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
  const document = getActiveDocument(readLgState());
  if (action.type !== "clear" && !document) {
    console.warn("[lg] No homework is open, so this action did nothing:", action);
    return;
  }

  noteLgActionTarget(action as { region_id?: string; near_region_id?: string });

  switch (action.type) {
    case "focus_region": {
      const item = findRegion(document, action.region_id);
      if (!item || !document) return;
      editor.zoomToBounds(regionFocusBounds(document, item), { inset: FOCUS_INSET, animation: { duration: 300 } });
      return;
    }
    case "circle_region": {
      const item = findRegion(document, action.region_id);
      if (!item || !document) return;
      const bounds = regionBounds(document, item);
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
      const from = findRegion(document, action.from_region_id);
      const to = findRegion(document, action.to_region_id);
      if (!from || !to || !document) return;
      const start = regionBounds(document, from);
      const end = regionBounds(document, to);
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
      if (document) writeNear(editor, document, action.near_region_id, action.text, "draw");
      return;
    case "write_math":
      // Mocked: shows the raw LaTeX until the KaTeX rendering is built.
      if (document) writeNear(editor, document, action.near_region_id, action.latex, "mono");
      return;
    case "clear": {
      const marks = editor.getCurrentPageShapes().filter((shape) => shape.meta.author === "tutor");
      editor.deleteShapes(marks);
      return;
    }
  }
}

// Remembered so region outlines drawn later, as pages are read, match the switch.
let regionsVisible = true;

export function setLgRegionsVisible(visible: boolean) {
  regionsVisible = visible;
  const editor = lgEditor;
  if (!editor) return;
  const updates: TLShapePartial[] = editor
    .getCurrentPageShapes()
    .filter((shape) => shape.meta.kind === "region")
    .map((shape) => ({ id: shape.id, type: shape.type, opacity: visible ? 1 : 0 }));
  editor.run(() => editor.updateShapes(updates), { history: "ignore", ignoreShapeLock: true });
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
    opacity: regionsVisible ? 1 : 0,
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

// Removes one file: its pages and outlines, and the tutor's marks on it. The student's own marks
// stay. The last file removes the homework altogether.
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
  editor.run(
    () => {
      editor.deleteShapes(shapes);
      if (assets.length) editor.deleteAssets(assets);
    },
    { history: "ignore", ignoreShapeLock: true },
  );
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
  setLgBackground("plain");
  editor.setCurrentTool("draw");
  focusLgPage(1);
  const unlink = linkLgBoard(editor);
  const stopWatchingHomework = watchHomeworkShapes(editor);
  const stopWatchingTool = react("lg current tool", () => setToolFromEditor(editor));
  const stopWatchingMarks = startChatOnFirstMark(editor);
  const stopWatchingFiles = watchBoardFiles(editor);
  const stopWatchingClicks = watchFileClicks(editor);
  return () => {
    unlink();
    stopWatchingHomework();
    stopWatchingTool();
    stopWatchingMarks();
    stopWatchingFiles();
    stopWatchingClicks();
    if (lgEditor === editor) {
      lgEditor = null;
      lgBoardId = null;
    }
  };
}
