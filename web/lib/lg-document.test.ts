// Run from web/: node --test lib/lg-regions.test.ts lib/lg-document.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

// Node needs the extension and TypeScript rejects it in a static import, so it's loaded here.
const lgDocument = (await import(`./lg-document${".ts"}`)) as typeof import("./lg-document");
const { checkFile, checkPageCount, compactReading, hashBytes, LgDocumentError, MAX_FILE_BYTES, readingCacheKey, sniffFileKind } =
  lgDocument;

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((part) => (typeof part === "string" ? [...part].map((char) => char.charCodeAt(0)) : part)));

test("file kinds come from the bytes, not the name", () => {
  assert.equal(sniffFileKind(bytes("%PDF-1.7\n")), "pdf");
  assert.equal(sniffFileKind(bytes([0xef, 0xbb, 0xbf], "\n%PDF-1.4")), "pdf");
  assert.equal(sniffFileKind(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a, 0])), "png");
  assert.equal(sniffFileKind(bytes([0xff, 0xd8, 0xff, 0xe0])), "jpeg");
  assert.equal(sniffFileKind(bytes("RIFF", [1, 2, 3, 4], "WEBPVP8 ")), "webp");
  assert.equal(sniffFileKind(bytes("RIFF", [1, 2, 3, 4], "WAVEfmt ")), null);
  assert.equal(sniffFileKind(bytes("PK", [3, 4], "word/document.xml")), null);
  assert.equal(sniffFileKind(bytes("GIF89a")), null);
  assert.equal(sniffFileKind(bytes("Hello %PD")), null);
});

test("unsupported, empty, HEIC and oversized files get clear messages", () => {
  assert.throws(() => checkFile(bytes("PK", [3, 4])), (error: Error) => error instanceof LgDocumentError && /export it as PDF/i.test(error.message));
  assert.throws(() => checkFile(new Uint8Array()), /empty/);
  assert.throws(() => checkFile(bytes([0, 0, 0, 0x18], "ftypheic", [0, 0])), /HEIC/);
  const big = new Uint8Array(MAX_FILE_BYTES + 1);
  big.set(bytes("%PDF-"));
  assert.throws(() => checkFile(big), /20 MB/);
  assert.equal(checkFile(bytes("%PDF-1.7")), "pdf");
});

test("page limits", () => {
  assert.doesNotThrow(() => checkPageCount(10));
  assert.throws(() => checkPageCount(11), /11 pages, and the limit is 10/);
  assert.throws(() => checkPageCount(0), /no pages/);
});

test("hashes and cache keys", async () => {
  assert.equal(await hashBytes(bytes("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(readingCacheKey("abc", 2, "pt"), "abc:2:pt");
});

test("cached readings are capped and sanitized", () => {
  const reading = compactReading({
    page: 1,
    page_text: "y".repeat(5000),
    problems: [{ label: "1", box_2d: ["10", 20, 30, 40] as unknown as number[], text: "z".repeat(1000) }],
  });
  assert.ok(reading.page_text.length <= 2001);
  assert.ok(reading.problems[0].text.length <= 601);
  assert.deepEqual(reading.problems[0].box_2d, [10, 20, 30, 40]);
  assert.deepEqual(compactReading({ page: 1, page_text: "", problems: null as unknown as [] }).problems, []);
});
