// Opening a homework file: checking it, rendering its pages and asking the API to read them (plan B1, B2).
// No runtime imports of other app modules, so its pure parts run under `node --test`.
// pdf.js needs browser APIs, so it is imported only inside renderPdf, when a PDF is uploaded.
import type { LgLanguage } from "./lg-types";

export const LG_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PAGES = 10;
// About 2000 px on the long side: sharp enough for Gemini and the board, and well inside
// tldraw's 5000 px and 10 MB asset limits and the API's 10 MB page limit.
export const RENDER_LONG_SIDE = 2000;
const PNG_MAX_BYTES = 4 * 1024 * 1024;
const JPEG_QUALITY = 0.9;
// A page takes about 15 s and the API gives up on Gemini after about 60 s.
export const READ_TIMEOUT_MS = 90_000;

export type LgFileKind = "pdf" | "png" | "jpeg" | "webp";

// Errors here carry a message that is safe to show the student.
export class LgDocumentError extends Error {}

const UNSUPPORTED = "This file type isn't supported. Export it as PDF first, or upload a PNG, JPG or WEBP photo.";

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((value, index) => bytes[offset + index] === value);
}

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

// What the file really is, from its first bytes. The name and declared type come from the user.
export function sniffFileKind(bytes: Uint8Array): LgFileKind | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "webp";
  // The PDF header may follow a little junk, which readers accept, so the first 1 KB is searched.
  const head = bytes.subarray(0, 1024);
  const marker = ascii("%PDF-");
  for (let offset = 0; offset + marker.length <= head.length; offset++) {
    if (startsWith(head, marker, offset)) return "pdf";
  }
  return null;
}

function isHeic(bytes: Uint8Array) {
  if (!startsWith(bytes, ascii("ftyp"), 4)) return false;
  const brand = String.fromCharCode(...bytes.subarray(8, 12));
  return ["heic", "heix", "hevc", "heif", "mif1", "msf1", "avif"].includes(brand);
}

function tooLarge() {
  return new LgDocumentError(
    `This file is larger than ${MAX_FILE_BYTES / (1024 * 1024)} MB. Export a smaller copy, or only the pages you need.`,
  );
}

// Checks size and type. Returns the kind, or throws a message for the student.
export function checkFile(bytes: Uint8Array): LgFileKind {
  if (bytes.length === 0) throw new LgDocumentError("This file is empty. Try exporting it again.");
  if (bytes.length > MAX_FILE_BYTES) throw tooLarge();
  const kind = sniffFileKind(bytes);
  if (kind) return kind;
  if (isHeic(bytes)) throw new LgDocumentError("iPhone photos (HEIC) aren't supported yet. Export it as JPG or PDF first.");
  throw new LgDocumentError(UNSUPPORTED);
}

export function checkPageCount(count: number) {
  if (count < 1) throw new LgDocumentError("This PDF has no pages.");
  if (count > MAX_PAGES) {
    throw new LgDocumentError(`This PDF has ${count} pages, and the limit is ${MAX_PAGES}. Export only the pages you need.`);
  }
}

export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

// A rendered page, ready for the board and for /documents/read-page.
export type LgRenderedPage = { number: number; blob: Blob; width: number; height: number };

function renderScale(width: number, height: number) {
  return Math.min(1, RENDER_LONG_SIDE / Math.max(width, height, 1));
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new LgDocumentError("A page couldn't be prepared. Try again."))), type, quality),
  );
}

// PNG keeps print sharp. A scanned page can make a huge PNG, so that falls back to JPEG.
async function encodePage(canvas: HTMLCanvasElement, preferPng: boolean): Promise<Blob> {
  if (preferPng) {
    const png = await canvasBlob(canvas, "image/png");
    if (png.size <= PNG_MAX_BYTES) return png;
  }
  return canvasBlob(canvas, "image/jpeg", JPEG_QUALITY);
}

function whiteCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new LgDocumentError("This browser couldn't draw the page. Try another browser.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  return { canvas, context };
}

type PdfJs = typeof import("pdfjs-dist");
let pdfjsLoading: Promise<PdfJs> | null = null;

// Loaded on first use, in the browser only. The worker is bundled from the package by
// `new Worker(new URL(...), import.meta.url)`, which Turbopack and webpack both understand.
function loadPdfJs(): Promise<PdfJs> {
  pdfjsLoading ??= import("pdfjs-dist").then((pdfjs) => {
    if (!pdfjs.GlobalWorkerOptions.workerPort) {
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), {
        type: "module",
      });
    }
    return pdfjs;
  });
  pdfjsLoading.catch(() => {
    pdfjsLoading = null;
  });
  return pdfjsLoading;
}

function pdfErrorMessage(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  if (name === "PasswordException") {
    return "This PDF is password-protected. Remove the password, or print it to a new PDF, and upload that.";
  }
  if (name === "InvalidPDFException") return "This PDF looks damaged and couldn't be opened. Try exporting it again.";
  return "This PDF couldn't be opened. Try exporting it again.";
}

// One PDF at a time. Every document shares the one worker port, and pdf.js destroys that shared
// worker when a document is destroyed, so a second render running alongside would break.
let pdfQueue: Promise<unknown> = Promise.resolve();

function renderPdf(bytes: Uint8Array): Promise<LgRenderedPage[]> {
  const run = pdfQueue.then(() => renderPdfNow(bytes));
  pdfQueue = run.catch(() => {});
  return run;
}

// Frees a canvas's pixels now. Safari caps total canvas memory and is slow to reclaim it.
function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

async function renderPdfNow(bytes: Uint8Array): Promise<LgRenderedPage[]> {
  const pdfjs = await loadPdfJs();
  // pdf.js 6 has no eval code path left (CVE-2024-4367 was fixed in 4.2), so there's no
  // isEvalSupported option to turn off. Scripting and XFA forms stay off.
  const task = pdfjs.getDocument({ data: bytes.slice(), enableXfa: false, stopAtErrors: false });
  let pdf: Awaited<typeof task.promise>;
  try {
    pdf = await task.promise;
  } catch (error) {
    await task.destroy().catch(() => {});
    throw new LgDocumentError(pdfErrorMessage(error));
  }
  try {
    checkPageCount(pdf.numPages);
    const pages: LgRenderedPage[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: RENDER_LONG_SIDE / Math.max(base.width, base.height) });
      const width = Math.round(viewport.width);
      const height = Math.round(viewport.height);
      const { canvas } = whiteCanvas(width, height);
      try {
        await page.render({ canvas, viewport }).promise;
        pages.push({ number, blob: await encodePage(canvas, true), width, height });
      } finally {
        releaseCanvas(canvas);
        page.cleanup();
      }
    }
    return pages;
  } catch (error) {
    if (error instanceof LgDocumentError) throw error;
    throw new LgDocumentError(pdfErrorMessage(error));
  } finally {
    await task.destroy().catch(() => {});
  }
}

async function renderImage(bytes: Uint8Array, kind: Exclude<LgFileKind, "pdf">): Promise<LgRenderedPage[]> {
  let bitmap: ImageBitmap;
  try {
    // from-image applies a photo's EXIF rotation, so the page is upright on the board and for Gemini.
    bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: `image/${kind}` }), {
      imageOrientation: "from-image",
    });
  } catch {
    throw new LgDocumentError("This image couldn't be opened. Try saving it again as JPG or PNG.");
  }
  try {
    const scale = renderScale(bitmap.width, bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const { canvas, context } = whiteCanvas(width, height);
    try {
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, width, height);
      return [{ number: 1, blob: await encodePage(canvas, kind === "png"), width, height }];
    } finally {
      releaseCanvas(canvas);
    }
  } finally {
    bitmap.close();
  }
}

// Checks a file and renders each of its pages to an image. Throws LgDocumentError for the student.
export async function openHomeworkFile(file: File): Promise<{ hash: string; pages: LgRenderedPage[] }> {
  // Checked before reading, so a huge file is never loaded into memory.
  if (file.size > MAX_FILE_BYTES) throw tooLarge();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = checkFile(bytes);
  const hash = await hashBytes(bytes);
  const pages = kind === "pdf" ? await renderPdf(bytes) : await renderImage(bytes, kind);
  return { hash, pages };
}

// The API client, shared with Check my work.

export async function apiErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  // A 422 from FastAPI has an array here, which isn't for the student.
  return typeof body?.detail === "string" ? body.detail : fallback;
}

export type LgPageReading = {
  page: number;
  page_text: string;
  problems: { label: string; box_2d: number[]; text: string }[];
};

export type LgReadOutcome =
  | { ok: true; reading: LgPageReading }
  // stop: later pages would fail the same way (Gemini busy, or no API), so don't try them now.
  | { ok: false; message: string; stop: boolean };

// Readings by file hash, page and language, so uploading the same file again costs no quota.
// It lives in localStorage beside the chats, so it stays small.
const CACHE_KEY = "lg-read-cache-v1";
const CACHE_ENTRIES = 40;
const CACHE_TEXT_MAX = 600;
const CACHE_PAGE_TEXT_MAX = 2000;

type CacheEntry = { key: string; reading: LgPageReading };

export function readingCacheKey(hash: string, page: number, language: LgLanguage) {
  return `${hash}:${page}:${language}`;
}

function loadCache(): CacheEntry[] {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCache(entries: CacheEntry[]) {
  // A full storage drops the oldest half and tries once more. The cache is only a saving.
  for (const attempt of [entries, entries.slice(Math.floor(entries.length / 2))]) {
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(attempt));
      return;
    } catch {
      // Try the smaller list, then give up.
    }
  }
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    // Storage is unavailable; reading still works without the cache.
  }
}

function capText(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function compactReading(reading: LgPageReading): LgPageReading {
  return {
    page: reading.page,
    page_text: capText(String(reading.page_text ?? ""), CACHE_PAGE_TEXT_MAX),
    problems: (Array.isArray(reading.problems) ? reading.problems : []).map((problem) => ({
      label: String(problem.label ?? ""),
      box_2d: Array.isArray(problem.box_2d) ? problem.box_2d.map(Number) : [],
      text: capText(String(problem.text ?? ""), CACHE_TEXT_MAX),
    })),
  };
}

function cachedReading(key: string): LgPageReading | null {
  return loadCache().find((entry) => entry.key === key)?.reading ?? null;
}

function cacheReading(key: string, reading: LgPageReading) {
  const entries = loadCache().filter((entry) => entry.key !== key);
  entries.push({ key, reading });
  saveCache(entries.slice(-CACHE_ENTRIES));
}

// Reads one page with Gemini through the API. Callers read pages one at a time.
export async function readHomeworkPage(
  image: Blob,
  { hash, page, language, signal }: { hash: string; page: number; language: LgLanguage; signal?: AbortSignal },
): Promise<LgReadOutcome> {
  const key = readingCacheKey(hash, page, language);
  const cached = cachedReading(key);
  if (cached) return { ok: true, reading: cached };

  const form = new FormData();
  form.append("image", image, image.type === "image/png" ? `page-${page}.png` : `page-${page}.jpg`);
  form.append("language", language);
  form.append("page", String(page));
  const timeout = AbortSignal.timeout(READ_TIMEOUT_MS);
  try {
    const response = await fetch(`${LG_API_URL}/documents/read-page`, {
      method: "POST",
      body: form,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
      const message = await apiErrorMessage(response, "This page couldn't be read.");
      return { ok: false, message, stop: response.status >= 500 };
    }
    const reading = compactReading((await response.json()) as LgPageReading);
    cacheReading(key, reading);
    return { ok: true, reading };
  } catch (error) {
    if (signal?.aborted) return { ok: false, message: "Reading was stopped.", stop: true };
    if (timeout.aborted || (error as { name?: string })?.name === "TimeoutError") {
      return { ok: false, message: "Reading this page took too long.", stop: true };
    }
    return { ok: false, message: "The homework reader can't reach the API. Is it running on port 8000?", stop: true };
  }
}
