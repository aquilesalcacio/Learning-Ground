// Where the homework sits on the board, read from the open document (plan B3).
// This is the only module that converts box_2d into board positions.
// Type-only imports keep it runnable under `node --test` without a bundler.
import type { LgDocument, LgDocumentFile, LgDocumentPage, LgRegion } from "./lg-types";

export type { LgRegion };

export type LgPage = { number: number; x: number; y: number; w: number; h: number };

export type LgBounds = { x: number; y: number; w: number; h: number };

export type LgBox = [number, number, number, number];

// A page's long side on the board, so a portrait Letter page is 816 x 1056 and landscape works too.
export const PAGE_LONG_SIDE = 1056;
const PAGE_GAP = 60;
const SCALE = 1000;
const WHOLE_PAGE: LgBox = [0, 0, SCALE, SCALE];

// Region text is kept in localStorage with the chat, so each page's share of it is capped.
const REGION_TEXT_MAX = 600;
const PAGE_TEXT_MAX = 4000;
const LABEL_MAX = 40;

// Board size for a rendered page of pixelW x pixelH.
export function boardPageSize(pixelW: number, pixelH: number): { w: number; h: number } {
  const scale = PAGE_LONG_SIDE / Math.max(pixelW, pixelH, 1);
  return { w: Math.max(1, Math.round(pixelW * scale)), h: Math.max(1, Math.round(pixelH * scale)) };
}

// A page with a saved position sits there. Pages without one (saved before files could be
// added or moved) stack down the board in order, each with its own size.
export function layoutPages(pages: Pick<LgDocumentPage, "number" | "w" | "h" | "x" | "y">[]): LgPage[] {
  let y = 0;
  return [...pages]
    .sort((a, b) => a.number - b.number)
    .map((page) => {
      if (typeof page.x === "number" && typeof page.y === "number") {
        return { number: page.number, x: page.x, y: page.y, w: page.w, h: page.h };
      }
      const placed = { number: page.number, x: 0, y, w: page.w, h: page.h };
      y += page.h + PAGE_GAP;
      return placed;
    });
}

// Files sit side by side. The gap leaves room for the tutor's margin notes beside a page
// (MARGIN_GAP + MARGIN_WIDTH below) and the left gutter of the next file.
export const FILE_GAP = 460;

// Positions for a new file's pages: a fresh column to the right of everything on the board,
// level with its top, pages stacked down it. The first file starts at the origin.
export function placeNewFile(document: LgDocument | null, sizes: { w: number; h: number }[]): { x: number; y: number }[] {
  const placed = document ? documentPages(document) : [];
  const x = placed.length ? Math.max(...placed.map((page) => page.x + page.w)) + FILE_GAP : 0;
  let y = placed.length ? Math.min(...placed.map((page) => page.y)) : 0;
  return sizes.map((size) => {
    const spot = { x, y };
    y += size.h + PAGE_GAP;
    return spot;
  });
}

// Homework saved before several files were allowed is one file with this ID.
export const SINGLE_FILE_ID = "file-1";

export function fileOfPage(page: Pick<LgDocumentPage, "file">): string {
  return page.file ?? SINGLE_FILE_ID;
}

export function documentFiles(document: LgDocument): LgDocumentFile[] {
  return (
    document.files ?? [
      { id: SINGLE_FILE_ID, filename: document.filename, hash: document.hash, page_count: document.pages.length },
    ]
  );
}

// The names shown to the tutor and used as a chat's title.
export function fileNames(files: Pick<LgDocumentFile, "filename">[]): string {
  return files.map((file) => file.filename).join(", ");
}

// The file and page number that key the reading cache for one of the document's pages.
export function pageSource(document: LgDocument, page: LgDocumentPage): { hash: string; page: number } {
  const file = documentFiles(document).find((item) => item.id === fileOfPage(page));
  return { hash: file?.hash ?? document.hash, page: page.source ?? page.number };
}

const layouts = new WeakMap<LgDocument, LgPage[]>();

export function documentPages(document: LgDocument): LgPage[] {
  let pages = layouts.get(document);
  if (!pages) {
    pages = layoutPages(document.pages);
    layouts.set(document, pages);
  }
  return pages;
}

export function findPage(document: LgDocument, number: number): LgPage | undefined {
  return documentPages(document).find((page) => page.number === number);
}

export function findRegion(document: LgDocument | null, region_id: string): LgRegion | undefined {
  return document?.regions.find((item) => item.region_id === region_id);
}

// box_2d to board bounds on a placed page.
export function boxBounds(page: LgPage, box: LgBox): LgBounds {
  const [ymin, xmin, ymax, xmax] = box;
  return {
    x: page.x + (xmin / SCALE) * page.w,
    y: page.y + (ymin / SCALE) * page.h,
    w: ((xmax - xmin) / SCALE) * page.w,
    h: ((ymax - ymin) / SCALE) * page.h,
  };
}

function pageOf(document: LgDocument, item: LgRegion): LgPage {
  const pages = documentPages(document);
  return pages.find((candidate) => candidate.number === item.page) ?? pages[0] ?? { number: 1, x: 0, y: 0, w: 0, h: 0 };
}

// The problem as printed. Circles and arrows use this.
export function regionBounds(document: LgDocument, item: LgRegion): LgBounds {
  return boxBounds(pageOf(document, item), item.box_2d);
}

// Gemini's boxes are tight around the printed problem and usually leave out the answer space
// below it. The working area runs across the page and down to just above the next problem below
// (one that overlaps it horizontally), or to the bottom of the page.
const NEXT_PROBLEM_GAP = 10;

export function workingBox(regions: LgRegion[], item: LgRegion): LgBox {
  const [ymin, xmin, ymax, xmax] = item.box_2d;
  const below = regions
    .filter(
      (other) =>
        other !== item &&
        other.page === item.page &&
        other.box_2d[0] >= ymax &&
        other.box_2d[1] < xmax &&
        other.box_2d[3] > xmin,
    )
    .map((other) => other.box_2d[0]);
  const bottom = below.length ? Math.min(...below) - NEXT_PROBLEM_GAP : SCALE;
  return [ymin, 0, Math.max(ymax, bottom), SCALE];
}

// The problem and the space the student answers it in. Check my work captures this.
export function regionWorkBounds(document: LgDocument, item: LgRegion): LgBounds {
  return boxBounds(pageOf(document, item), workingBox(document.regions, item));
}

// Tutor text goes in a margin beside the page. Focus always keeps that margin on screen.
export const MARGIN_WIDTH = 300;
const MARGIN_GAP = 32;
const LEFT_GUTTER = 48;
const FOCUS_PADDING_Y = 24;

function withMargin(page: LgPage, y: number, h: number): LgBounds {
  return { x: page.x - LEFT_GUTTER, y, w: LEFT_GUTTER + page.w + MARGIN_GAP + MARGIN_WIDTH, h };
}

export function pageFocusBounds(page: LgPage): LgBounds {
  return withMargin(page, page.y, page.h);
}

export function regionFocusBounds(document: LgDocument, item: LgRegion): LgBounds {
  const bounds = regionWorkBounds(document, item);
  return withMargin(pageOf(document, item), bounds.y - FOCUS_PADDING_Y, bounds.h + FOCUS_PADDING_Y * 2);
}

export function regionMarginX(document: LgDocument, item: LgRegion): number {
  const page = pageOf(document, item);
  return page.x + page.w + MARGIN_GAP;
}

// Building regions from what /documents/read-page returns.

export type LgPageProblem = { label: string; box_2d: number[]; text: string };

function cap(text: string, max: number): string {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
}

// "3", "3b" or "4)" read as "Problem 3"; a label that's already words, such as "Exercise 2", stays.
export function problemLabel(label: string, k: number): string {
  const clean = cap(label.replace(/\s+/g, " "), LABEL_MAX).replace(/[).:]+$/, "");
  if (!clean) return `Problem ${k}`;
  return /^[0-9]+[a-z]?$|^[a-z]$/i.test(clean) ? `Problem ${clean}` : clean;
}

function validBox(box: number[]): LgBox | null {
  if (box.length !== 4 || !box.every((value) => Number.isFinite(value))) return null;
  const [ymin, xmin, ymax, xmax] = box.map((value) => Math.min(Math.max(Math.round(value), 0), SCALE));
  return ymax > ymin && xmax > xmin ? [ymin, xmin, ymax, xmax] : null;
}

// One region for the whole page: before it's read, if reading fails, or if no problem was found.
export function wholePageRegion(page: number, text = ""): LgRegion {
  return { region_id: `p${page}.page`, label: `Page ${page}`, page, box_2d: [...WHOLE_PAGE], text: cap(text, PAGE_TEXT_MAX) };
}

// IDs are p{page}.q{k}, numbered in reading order on that page. No usable box gives p{page}.page.
export function pageRegions(page: number, problems: LgPageProblem[], pageText = ""): LgRegion[] {
  const regions: LgRegion[] = [];
  let budget = PAGE_TEXT_MAX;
  for (const problem of problems) {
    const box = validBox(problem.box_2d);
    if (!box) continue;
    const k = regions.length + 1;
    const text = cap(problem.text, Math.min(REGION_TEXT_MAX, Math.max(budget, 0)));
    budget -= text.length;
    regions.push({ region_id: `p${page}.q${k}`, label: problemLabel(problem.label, k), page, box_2d: box, text });
  }
  return regions.length ? regions : [wholePageRegion(page, pageText)];
}

// Swaps one page's regions in the document's list, keeping page order.
export function replacePageRegions(regions: LgRegion[], page: number, next: LgRegion[]): LgRegion[] {
  return [...regions.filter((item) => item.page !== page), ...next].sort((a, b) => a.page - b.page);
}
