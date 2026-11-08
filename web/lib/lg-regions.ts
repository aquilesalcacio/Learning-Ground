// Where the homework sits on the board, read from the open document (plan B3).
// This is the only module that converts box_2d into board positions.
// Type-only imports keep it runnable under `node --test` without a bundler.
import type { LgDocument, LgDocumentFile, LgDocumentPage, LgRegion, LgRegionLine } from "./lg-types";

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
// A problem's lines repeat its text, so they get the same budgets: REGION_TEXT_MAX per problem
// and PAGE_TEXT_MAX per page, at most LINES_MAX lines of LINE_TEXT_MAX characters each.
const LINES_MAX = 12;
const LINE_TEXT_MAX = 160;

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

function holds(area: LgBounds, point: { x: number; y: number }) {
  return point.x >= area.x && point.x <= area.x + area.w && point.y >= area.y && point.y <= area.y + area.h;
}

// How far a point is from the left-to-right run of a problem's printed box: 0 when it's under it.
function sideways(document: LgDocument, item: LgRegion, point: { x: number; y: number }) {
  const bounds = regionBounds(document, item);
  return Math.max(bounds.x - point.x, point.x - (bounds.x + bounds.w), 0);
}

// The problem at a board point: the one printed there, or else the one whose working area holds
// it, so writing under a problem belongs to it. Working areas cross the whole page, so for
// problems side by side the printed box decides: on it, or else under it or nearest beside it.
// The margin beside the page is no problem's.
export function regionAt(document: LgDocument | null, point: { x: number; y: number }): LgRegion | undefined {
  if (!document) return undefined;
  const printed = document.regions.find((item) => holds(regionBounds(document, item), point));
  if (printed) return printed;
  let best: LgRegion | undefined;
  let bestDistance = Infinity;
  for (const item of document.regions) {
    if (!holds(regionWorkBounds(document, item), point)) continue;
    const distance = sideways(document, item, point);
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
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

export type LgPageProblem = { label: string; box_2d: number[]; text: string; lines?: { text: string; box_2d: number[] }[] };

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

// A problem's usable lines: a valid box and some text, within the budgets above. The page's
// budget is passed in and what these lines use is returned with them. A line is kept whole or
// not at all, since a phrase's place on it is estimated from its text across its whole box: a
// line too long is skipped, and the lines stop at the first one the budget can't hold.
function problemLines(lines: LgPageProblem["lines"], pageBudget: number): { lines: LgRegionLine[]; used: number } {
  const kept: LgRegionLine[] = [];
  let budget = Math.min(REGION_TEXT_MAX, pageBudget);
  for (const line of Array.isArray(lines) ? lines : []) {
    if (kept.length === LINES_MAX || budget <= 0) break;
    const box = validBox(Array.isArray(line?.box_2d) ? line.box_2d : []);
    const text = String(line?.text ?? "").replace(/\s+/g, " ").trim();
    if (!box || !text || text.length > LINE_TEXT_MAX) continue;
    if (text.length > budget) break;
    budget -= text.length;
    kept.push({ text, box_2d: box });
  }
  return { lines: kept, used: Math.min(REGION_TEXT_MAX, pageBudget) - budget };
}

// IDs are p{page}.q{k}, numbered in reading order on that page. No usable box gives p{page}.page.
export function pageRegions(page: number, problems: LgPageProblem[], pageText = ""): LgRegion[] {
  const regions: LgRegion[] = [];
  let budget = PAGE_TEXT_MAX;
  let lineBudget = PAGE_TEXT_MAX;
  for (const problem of problems) {
    const box = validBox(problem.box_2d);
    if (!box) continue;
    const k = regions.length + 1;
    const text = cap(problem.text, Math.min(REGION_TEXT_MAX, Math.max(budget, 0)));
    budget -= text.length;
    const { lines, used } = problemLines(problem.lines, lineBudget);
    lineBudget -= used;
    regions.push({
      region_id: `p${page}.q${k}`,
      label: problemLabel(problem.label, k),
      page,
      box_2d: box,
      text,
      ...(lines.length ? { lines } : {}),
    });
  }
  return regions.length ? regions : [wholePageRegion(page, pageText)];
}

// Marking an exact phrase: the tutor names words from a problem's text, and these find the line
// that holds them and estimate where on that line they fall. Both sides are compared without
// spaces, case or accents, so "2x+6=14" finds "2x + 6 = 14", but with their math symbols, so "1/2"
// never finds "12" and "x - 3" never finds "x = 3". A longer phrase may be off by a character in
// five, as when Gemini read a word slightly differently.
const PHRASE_MAX = 120;
const FUZZY_MIN = 5;
const FUZZY_SHARE = 0.2;

// Math symbols are compared too. Look-alikes count as the plain symbol: a minus sign or a dash as
// "-", a times sign as "*", a division sign or a fraction slash as "/".
const MATH_SYMBOLS = new Set(".,/:+-=<>%^()[]*≤≥≠");
const LOOK_ALIKES: Record<string, string> = {
  "\u2212": "-",
  "\u2013": "-",
  "\u2014": "-",
  "×": "*",
  "·": "*",
  "÷": "/",
  "\u2044": "/",
  "\u2215": "/",
};
const plainSymbol = (char: string) => LOOK_ALIKES[char] ?? char;
const isAlphanumeric = (char: string) => /[0-9]/.test(char) || char.toLowerCase() !== char.toUpperCase();
// Inside a number such as 2.5, 1,200 or 1/2, or a power such as x^2, these join it into one word.
const JOINERS = new Set(".,/^");

// Letters, digits and math symbols, each with the index of the character it came from.
function comparable(text: string): { chars: string[]; from: number[] } {
  const chars: string[] = [];
  const from: number[] = [];
  Array.from(text).forEach((char, index) => {
    const plain = plainSymbol(char);
    // Kept as they are: NFKD would turn ≠ into =.
    if (MATH_SYMBOLS.has(plain)) {
      chars.push(plain);
      from.push(index);
      return;
    }
    // NFKD splits accents off and turns ² into 2 and ½ into 1⁄2; the accents are then dropped.
    for (const part of char.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()) {
      const symbol = plainSymbol(part);
      if (isAlphanumeric(symbol) || MATH_SYMBOLS.has(symbol)) {
        chars.push(symbol);
        from.push(index);
      }
    }
  });
  return { chars, from };
}

// A phrase's characters, without the punctuation that ends a sentence or a clause around it, which
// the tutor may copy or leave out.
function phraseChars(phrase: string): string[] {
  const chars = comparable(phrase).chars;
  while (chars.length && ".,:;".includes(chars[chars.length - 1])) chars.pop();
  while (chars.length && ",:;".includes(chars[0])) chars.shift();
  return chars;
}

// Where words start, for a run of characters with their places: breaks[k] is true when a space or
// a line break comes before character k, or when k is where letters and digits meet a symbol, as
// in "x=3" or "(5)". A joiner inside a number, as in "2.5", is part of it, so "5" there isn't whole.
function wordBreaks(chars: string[], places: { line: number; index: number }[]): boolean[] {
  const next = (k: number) => k + 1 < places.length && places[k + 1].line === places[k].line && places[k + 1].index === places[k].index + 1;
  const prev = (k: number) => k > 0 && next(k - 1);
  const wordy = (k: number) =>
    isAlphanumeric(chars[k]) ||
    (JOINERS.has(chars[k]) && prev(k) && next(k) && isAlphanumeric(chars[k - 1]) && isAlphanumeric(chars[k + 1]));
  return places.map((_, k) => !prev(k) || wordy(k - 1) !== wordy(k));
}

// Where the phrase best matches inside the text, as [start, end) in its characters, or null.
// Exact first, preferring one that starts and ends where words do (breaks[k]: a space or a line
// break comes before character k), so "5" finds "gives 5" before "15"; otherwise the substring
// with the fewest edits (Sellers' algorithm), if few enough.
function findPhrase(text: string[], phrase: string[], breaks: boolean[]): [number, number] | null {
  const m = phrase.length;
  if (!m || !text.length) return null;
  let first: [number, number] | null = null;
  for (let at = 0; at + m <= text.length; at += 1) {
    if (!phrase.every((char, index) => text[at + index] === char)) continue;
    if (breaks[at] && (at + m === text.length || breaks[at + m])) return [at, at + m];
    first ??= [at, at + m];
  }
  if (first) return first;
  if (m < FUZZY_MIN) return null;
  const allowed = Math.floor(m * FUZZY_SHARE);
  // cost[j] and start[j]: the fewest edits matching the phrase so far to text ending at j.
  let cost = Array.from({ length: text.length + 1 }, () => 0);
  let start = Array.from({ length: text.length + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const nextCost = [i];
    const nextStart = [0];
    for (let j = 1; j <= text.length; j += 1) {
      const swap = cost[j - 1] + (phrase[i - 1] === text[j - 1] ? 0 : 1);
      const skipPhrase = cost[j] + 1;
      const skipText = nextCost[j - 1] + 1;
      if (swap <= skipPhrase && swap <= skipText) {
        nextCost.push(swap);
        nextStart.push(start[j - 1]);
      } else if (skipPhrase <= skipText) {
        nextCost.push(skipPhrase);
        nextStart.push(start[j]);
      } else {
        nextCost.push(skipText);
        nextStart.push(nextStart[j - 1]);
      }
    }
    cost = nextCost;
    start = nextStart;
  }
  let best = -1;
  for (let j = 1; j <= text.length; j += 1) if (best < 0 || cost[j] < cost[best]) best = j;
  if (best < 0 || cost[best] > allowed || start[best] >= best) return null;
  return [start[best], best];
}

// How wide a character is next to an average one, roughly, in a printed font.
function charWidth(char: string): number {
  if (/\s/.test(char)) return 0.5;
  if (/[.,:;'!|ilj]/.test(char)) return 0.4;
  if (/[()[\]{}\-/frtI1]/.test(char)) return 0.6;
  if (/[mwMW]/.test(char)) return 1.4;
  return 1;
}

// The part of a line from character `from` up to `to`, by the widths of the characters before
// each, with half a character to spare on both sides.
function lineSpan(line: LgRegionLine, from: number, to: number): LgBox {
  const [ymin, xmin, ymax, xmax] = line.box_2d;
  const widths = Array.from(line.text).map(charWidth);
  const total = widths.reduce((sum, width) => sum + width, 0) || 1;
  const before = (end: number) => widths.slice(0, end).reduce((sum, width) => sum + width, 0);
  const unit = (xmax - xmin) / total;
  const left = Math.max(xmin, xmin + before(from) * unit - unit / 2);
  const right = Math.min(xmax, xmin + before(to) * unit + unit / 2);
  return [ymin, left, ymax, Math.max(right, Math.min(xmax, left + unit))];
}

// The boxes, in box_2d units, that hold a phrase from the problem: one per line it runs across.
// Empty when the problem has no lines, read before they were, or the phrase isn't found.
export function phraseBoxes(item: Pick<LgRegion, "lines">, phrase: string): LgBox[] {
  const lines = item.lines ?? [];
  const wanted = phraseChars(String(phrase ?? "").slice(0, PHRASE_MAX));
  if (!lines.length || !wanted.length) return [];
  // The problem's lines as one run of characters, each knowing its line and its place there.
  const chars: string[] = [];
  const places: { line: number; index: number }[] = [];
  lines.forEach((line, lineIndex) => {
    const { chars: lineChars, from } = comparable(line.text);
    chars.push(...lineChars);
    places.push(...from.map((index) => ({ line: lineIndex, index })));
  });
  const found = findPhrase(chars, wanted, wordBreaks(chars, places));
  if (!found) return [];
  const spans = new Map<number, { from: number; to: number }>();
  for (const { line, index } of places.slice(found[0], found[1])) {
    const span = spans.get(line);
    spans.set(line, span ? { from: span.from, to: index + 1 } : { from: index, to: index + 1 });
  }
  return [...spans].map(([line, span]) => lineSpan(lines[line], span.from, span.to));
}

// The same boxes in board positions, for underlining or highlighting just that phrase.
export function phraseBounds(document: LgDocument, item: LgRegion, phrase: string): LgBounds[] {
  const page = pageOf(document, item);
  return phraseBoxes(item, phrase).map((box) => boxBounds(page, box));
}

// Swaps one page's regions in the document's list, keeping page order.
export function replacePageRegions(regions: LgRegion[], page: number, next: LgRegion[]): LgRegion[] {
  return [...regions.filter((item) => item.page !== page), ...next].sort((a, b) => a.page - b.page);
}
