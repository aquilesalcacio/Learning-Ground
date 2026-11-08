// Run from web/: node --test lib/lg-regions.test.ts lib/lg-document.test.ts
// Node strips the types itself, so this needs no test framework.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { LgDocument } from "./lg-types";

// Node needs the extension and TypeScript rejects it in a static import, so it's loaded here.
const regions = (await import(`./lg-regions${".ts"}`)) as typeof import("./lg-regions");
const {
  boardPageSize,
  documentFiles,
  documentPages,
  FILE_GAP,
  fileNames,
  findRegion,
  pageSource,
  placeNewFile,
  pageRegions,
  problemLabel,
  regionAt,
  regionBounds,
  regionWorkBounds,
  replacePageRegions,
  wholePageRegion,
  workingBox,
} = regions;

function documentWith(pages: { w: number; h: number }[], list = pages.map((_, index) => wholePageRegion(index + 1))): LgDocument {
  return {
    filename: "sheet.pdf",
    page_count: pages.length,
    status: "ready",
    hash: "abc",
    pages: pages.map((page, index) => ({ number: index + 1, ...page, read: "done" })),
    regions: list,
  };
}

test("region IDs are built per page in reading order", () => {
  const built = pageRegions(2, [
    { label: "1", box_2d: [100, 50, 200, 950], text: "2x + 3 = 7" },
    { label: "2b", box_2d: [300, 50, 400, 950], text: "x^2 = 9" },
    { label: "Exercise 3", box_2d: [500, 50, 600, 950], text: "" },
  ]);
  assert.deepEqual(
    built.map((item) => [item.region_id, item.label, item.page]),
    [
      ["p2.q1", "Problem 1", 2],
      ["p2.q2", "Problem 2b", 2],
      ["p2.q3", "Exercise 3", 2],
    ],
  );
  assert.equal(built[0].text, "2x + 3 = 7");
});

test("unusable boxes are skipped and numbering stays continuous", () => {
  const built = pageRegions(1, [
    { label: "1", box_2d: [100, 50, 90, 950], text: "inverted" },
    { label: "2", box_2d: [1, 2, 3], text: "short" },
    { label: "3", box_2d: [100, 50, 200, Number.NaN], text: "nan" },
    { label: "4", box_2d: [-20, 50, 1200, 950], text: "clamped" },
  ]);
  assert.deepEqual(
    built.map((item) => [item.region_id, item.box_2d]),
    [["p1.q1", [0, 50, 1000, 950]]],
  );
});

test("a page with no problems becomes one whole-page region holding the page text", () => {
  const built = pageRegions(3, [], "Read chapter 4.");
  assert.deepEqual(built, [
    { region_id: "p3.page", label: "Page 3", page: 3, box_2d: [0, 0, 1000, 1000], text: "Read chapter 4." },
  ]);
  assert.equal(pageRegions(1, [{ label: "1", box_2d: [5, 5, 5, 5], text: "" }])[0].region_id, "p1.page");
});

test("region text is capped per region and per page", () => {
  const long = "x".repeat(5000);
  const built = pageRegions(
    1,
    Array.from({ length: 10 }, (_, index) => ({ label: String(index + 1), box_2d: [index * 90, 0, index * 90 + 50, 1000], text: long })),
  );
  assert.ok(built.every((item) => item.text.length <= 601));
  assert.ok(built.reduce((sum, item) => sum + item.text.length, 0) <= 4000 + built.length);
});

test("labels", () => {
  assert.equal(problemLabel("4)", 1), "Problem 4");
  assert.equal(problemLabel("  ", 2), "Problem 2");
  assert.equal(problemLabel("a", 1), "Problem a");
  assert.equal(problemLabel("Problem 4", 1), "Problem 4");
});

test("board page sizes keep the aspect ratio with a 1056 long side, portrait or landscape", () => {
  assert.deepEqual(boardPageSize(1545, 2000), { w: 816, h: 1056 });
  assert.deepEqual(boardPageSize(2000, 1545), { w: 1056, h: 816 });
  assert.deepEqual(boardPageSize(1414, 2000), { w: 747, h: 1056 });
});

test("box_2d converts with each page's own size and position", () => {
  const document = documentWith([
    { w: 816, h: 1056 },
    { w: 1056, h: 816 },
  ]);
  const pages = documentPages(document);
  assert.deepEqual(
    pages.map((page) => [page.x, page.y]),
    [
      [0, 0],
      [0, 1056 + 60],
    ],
  );
  const onLandscape = pageRegions(2, [{ label: "1", box_2d: [500, 250, 750, 500], text: "" }])[0];
  const placed = { ...document, regions: [onLandscape] };
  assert.deepEqual(regionBounds(placed, onLandscape), { x: 264, y: 1116 + 408, w: 264, h: 204 });
});

test("the working area runs down to just above the next problem below, or to the page bottom", () => {
  const list = pageRegions(1, [
    { label: "1", box_2d: [100, 50, 200, 950], text: "" },
    { label: "2", box_2d: [400, 50, 500, 950], text: "" },
    { label: "3", box_2d: [700, 50, 800, 480], text: "" },
    // Beside problem 3, so it doesn't cut problem 3's area short.
    { label: "4", box_2d: [720, 520, 780, 950], text: "" },
  ]);
  assert.deepEqual(workingBox(list, list[0]), [100, 0, 390, 1000]);
  assert.deepEqual(workingBox(list, list[1]), [400, 0, 690, 1000]);
  assert.deepEqual(workingBox(list, list[2]), [700, 0, 1000, 1000]);
  assert.deepEqual(workingBox(list, list[3]), [720, 0, 1000, 1000]);

  // Problems on another page never limit it.
  const other = pageRegions(2, [{ label: "1", box_2d: [300, 50, 350, 950], text: "" }]);
  assert.deepEqual(workingBox([...list, ...other], list[2]), [700, 0, 1000, 1000]);

  const document = documentWith([{ w: 816, h: 1056 }], list);
  const area = regionWorkBounds(document, list[0]);
  assert.deepEqual([area.x, area.w], [0, 816]);
  assert.ok(Math.abs(area.y - 105.6) < 1e-9 && Math.abs(area.h - 306.24) < 1e-9);
});

test("finding and replacing a page's regions", () => {
  const document = documentWith([
    { w: 816, h: 1056 },
    { w: 816, h: 1056 },
  ]);
  assert.equal(findRegion(document, "p2.page")?.page, 2);
  assert.equal(findRegion(null, "p1.page"), undefined);
  const next = replacePageRegions(
    document.regions,
    1,
    pageRegions(1, [
      { label: "1", box_2d: [100, 0, 200, 1000], text: "" },
      { label: "2", box_2d: [300, 0, 400, 1000], text: "" },
    ]),
  );
  assert.deepEqual(
    next.map((item) => item.region_id),
    ["p1.q1", "p1.q2", "p2.page"],
  );
});

test("saved page positions are kept, and pages without one still stack from the top", () => {
  const document = documentWith([{ w: 816, h: 1056 }, { w: 816, h: 1056 }]);
  document.pages[1] = { ...document.pages[1], x: 1500, y: -200 };
  const [first, second] = documentPages(document);
  assert.deepEqual([first.x, first.y], [0, 0]);
  assert.deepEqual([second.x, second.y], [1500, -200]);
});

test("a new file gets its own column to the right, level with the top, leaving room for margin notes", () => {
  assert.deepEqual(placeNewFile(null, [{ w: 816, h: 1056 }, { w: 816, h: 1056 }]), [
    { x: 0, y: 0 },
    { x: 0, y: 1116 },
  ]);
  const document = documentWith([{ w: 816, h: 1056 }, { w: 1056, h: 816 }]);
  document.pages[0] = { ...document.pages[0], x: 0, y: 40 };
  document.pages[1] = { ...document.pages[1], x: 0, y: 1156 };
  const [spot] = placeNewFile(document, [{ w: 816, h: 1056 }]);
  assert.equal(spot.x, 1056 + FILE_GAP);
  assert.equal(spot.y, 40);
});

test("files: homework saved as one file, and each page's reading-cache key", () => {
  const single = documentWith([{ w: 816, h: 1056 }]);
  assert.deepEqual(documentFiles(single), [{ id: "file-1", filename: "sheet.pdf", hash: "abc", page_count: 1 }]);
  assert.deepEqual(pageSource(single, single.pages[0]), { hash: "abc", page: 1 });

  const two: LgDocument = {
    ...single,
    files: [
      { id: "a", filename: "sheet.pdf", hash: "abc", page_count: 1 },
      { id: "b", filename: "photo.png", hash: "def", page_count: 1 },
    ],
    pages: [
      { ...single.pages[0], file: "a", source: 1 },
      { number: 2, w: 816, h: 1056, read: "pending", file: "b", source: 1 },
    ],
  };
  assert.deepEqual(pageSource(two, two.pages[1]), { hash: "def", page: 1 });
  assert.equal(fileNames(documentFiles(two)), "sheet.pdf, photo.png");
});

test("the region at a point: its printed box first, then the space under it, never the margin", () => {
  const document = documentWith(
    [{ w: 1000, h: 1000 }],
    [
      { region_id: "p1.q1", label: "Problem 1", page: 1, box_2d: [100, 50, 200, 450], text: "" },
      { region_id: "p1.q2", label: "Problem 2", page: 1, box_2d: [100, 550, 200, 950], text: "" },
      { region_id: "p1.q3", label: "Problem 3", page: 1, box_2d: [500, 50, 600, 950], text: "" },
    ],
  );
  // Side by side, both working areas cross the page: the printed box decides.
  assert.equal(regionAt(document, { x: 700, y: 150 })?.region_id, "p1.q2");
  assert.equal(regionAt(document, { x: 100, y: 150 })?.region_id, "p1.q1");
  // Under problem 3, where the student works it.
  assert.equal(regionAt(document, { x: 500, y: 800 })?.region_id, "p1.q3");
  // The margin beside the page belongs to no problem.
  assert.equal(regionAt(document, { x: 1100, y: 550 }), undefined);
  assert.equal(regionAt(null, { x: 100, y: 150 }), undefined);
});
