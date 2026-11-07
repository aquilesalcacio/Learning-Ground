// Field names follow the data model in docs/learning-grounds-vision.md, section 8.6.

export type LgLanguage = "pt" | "es" | "en";
export type TutorTone = "casual" | "humorous" | "formal";
export type TeachingStyle = "socratic" | "worked_example" | "visual_first";
export type TutorColor = "blue" | "red" | "green" | "orange" | "violet";
export type PenColor = TutorColor | "black";
export type LgBackground = "plain" | "grid" | "dark";

export type Tutor = {
  id: string;
  name: string;
  color: TutorColor;
  voice_id: string;
  language: LgLanguage | "";
  tone: TutorTone | "";
  style: TeachingStyle | "";
  persona_prompt: string;
  is_preset: boolean;
};

export type StudentProfile = {
  name: string;
  school: string;
  courses: string;
  language: LgLanguage | "";
  struggles: string;
};

// One page of the homework, in board units. Its image lives in the board's IndexedDB, not here.
// read: whether Gemini has read it. A pending or failed page has one whole-page region, p{n}.page.
export type LgDocumentPage = {
  number: number;
  w: number;
  h: number;
  read: "pending" | "done" | "failed";
};

// A problem on a page. The app builds region_id (p1.q3, or p1.page for a whole page), never Gemini.
export type LgRegion = {
  region_id: string;
  label: string;
  page: number;
  // [ymin, xmin, ymax, xmax] on a 0-1000 scale of the page as displayed. Only lg-regions.ts converts it.
  box_2d: [number, number, number, number];
  text: string;
};

export type LgDocument = {
  filename: string;
  page_count: number;
  // "reading" while Gemini works through the pages; the pages are usable throughout.
  status: "reading" | "ready";
  // SHA-256 of the file's bytes, which keys the page-reading cache.
  hash: string;
  pages: LgDocumentPage[];
  regions: LgRegion[];
};

export type ChatSpeaker = "student" | "tutor" | "system";

export type ChatMessage = {
  id: string;
  who: ChatSpeaker;
  text: string;
};

// One run of the board with one tutor, with its own homework. The left sidebar lists these.
export type Conversation = {
  id: string;
  tutor_id: string;
  title: string;
  created_at: number;
  messages: ChatMessage[];
  document: LgDocument | null;
};

export type Option<T extends string> = { value: T; label: string };

export const LANGUAGE_OPTIONS: Option<LgLanguage>[] = [
  { value: "pt", label: "Portuguese" },
  { value: "es", label: "Spanish" },
  { value: "en", label: "English" },
];

export const TONE_OPTIONS: Option<TutorTone>[] = [
  { value: "casual", label: "Casual" },
  { value: "humorous", label: "Humorous" },
  { value: "formal", label: "Formal" },
];

export const STYLE_OPTIONS: Option<TeachingStyle>[] = [
  { value: "socratic", label: "Socratic" },
  { value: "worked_example", label: "Worked example on a similar problem" },
  { value: "visual_first", label: "Visual-first" },
];

// Placeholders until the ElevenLabs voice list is wired in.
export const VOICE_OPTIONS: Option<string>[] = [
  { value: "voice_a", label: "Voice A (placeholder)" },
  { value: "voice_b", label: "Voice B (placeholder)" },
  { value: "voice_c", label: "Voice C (placeholder)" },
];

export const BACKGROUND_OPTIONS: Option<LgBackground>[] = [
  { value: "plain", label: "Plain" },
  { value: "grid", label: "Grid" },
  { value: "dark", label: "Dark" },
];

export const TUTOR_COLORS: TutorColor[] = ["blue", "red", "green", "orange", "violet"];
export const PEN_COLORS: PenColor[] = ["black", ...TUTOR_COLORS];

export const COLOR_HEX: Record<PenColor, string> = {
  black: "#1d1d1d",
  blue: "#4263eb",
  red: "#e03131",
  green: "#099268",
  orange: "#e8590c",
  violet: "#ae3ec9",
};

export function optionLabel<T extends string>(options: Option<T>[], value: T | ""): string {
  return options.find((option) => option.value === value)?.label ?? "Not set";
}
