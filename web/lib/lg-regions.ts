// Mocked fixture standing in for Gemini vision pre-processing (vision doc, section 8.3).
// This is the only module that converts box_2d into board positions.

export type LgRegion = {
  region_id: string;
  label: string;
  page: number;
  // [ymin, xmin, ymax, xmax] on a 0-1000 scale for the page.
  box_2d: [number, number, number, number];
  text: string;
  brief: { solution_steps: string[]; common_mistakes: string[] };
};

export type LgPage = { number: number; x: number; y: number; w: number; h: number };

export type LgBounds = { x: number; y: number; w: number; h: number };

const PAGE_W = 816;
const PAGE_H = 1056;
const PAGE_GAP = 60;

export const LG_PAGES: LgPage[] = [1, 2].map((number) => ({
  number,
  x: 0,
  y: (number - 1) * (PAGE_H + PAGE_GAP),
  w: PAGE_W,
  h: PAGE_H,
}));

function region(page: number, question: number, box_2d: LgRegion["box_2d"]): LgRegion {
  return {
    region_id: `p${page}.q${question}`,
    label: `Problem ${question}`,
    page,
    box_2d,
    text: "",
    brief: { solution_steps: [], common_mistakes: [] },
  };
}

export const LG_REGIONS: LgRegion[] = [
  region(1, 1, [70, 60, 280, 940]),
  region(1, 2, [300, 60, 510, 940]),
  region(1, 3, [530, 60, 740, 940]),
  region(1, 4, [760, 60, 960, 940]),
  region(2, 5, [70, 60, 420, 940]),
  region(2, 6, [440, 60, 790, 940]),
];

export function findRegion(region_id: string): LgRegion | undefined {
  return LG_REGIONS.find((item) => item.region_id === region_id);
}

function pageOf(item: LgRegion): LgPage {
  return LG_PAGES.find((candidate) => candidate.number === item.page) ?? LG_PAGES[0];
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

export function regionFocusBounds(item: LgRegion): LgBounds {
  const bounds = regionBounds(item);
  return withMargin(pageOf(item), bounds.y - FOCUS_PADDING_Y, bounds.h + FOCUS_PADDING_Y * 2);
}

export function regionMarginX(item: LgRegion): number {
  const page = pageOf(item);
  return page.x + page.w + MARGIN_GAP;
}

export function regionBounds(item: LgRegion): LgBounds {
  const page = pageOf(item);
  const [ymin, xmin, ymax, xmax] = item.box_2d;
  return {
    x: page.x + (xmin / 1000) * page.w,
    y: page.y + (ymin / 1000) * page.h,
    w: ((xmax - xmin) / 1000) * page.w,
    h: ((ymax - ymin) / 1000) * page.h,
  };
}
