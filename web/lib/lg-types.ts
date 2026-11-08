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
  // Imported from Canvas LMS: one "Course: assignment (due ...)" per line.
  upcoming: string;
};

// One page of the homework, in board units. Its image lives in the board's IndexedDB, not here.
// read: whether Gemini has read it. A pending or failed page has one whole-page region, p{n}.page.
export type LgDocumentPage = {
  number: number;
  w: number;
  h: number;
  read: "pending" | "done" | "failed";
  // Where the page sits on the board. Every upload sets it, because files sit side by side and
  // the student can move them. Pages saved before that have none, and stack down from the top.
  x?: number;
  y?: number;
  // The file it came from (an LgDocument.files id), and its page number inside that file, which
  // keys the reading cache. Pages saved before files have neither: they belong to one file.
  file?: string;
  source?: number;
};

// One uploaded file. A chat's homework can hold several, each in its own column on the board.
export type LgDocumentFile = {
  id: string;
  filename: string;
  hash: string;
  page_count: number;
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

// A chat's homework: one or more files. Pages are numbered across all of them, so region IDs
// such as p3.q1 stay unique. filename lists every file's name, for the tutor and the chat title.
export type LgDocument = {
  filename: string;
  page_count: number;
  // Missing on homework saved before several files were allowed: then it's the one file.
  files?: LgDocumentFile[];
  // "reading" while Gemini works through the pages; the pages are usable throughout.
  status: "reading" | "ready";
  // SHA-256 of the first file's bytes. It identifies this homework while its pages are read;
  // each file's own hash, in files, keys the page-reading cache.
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

// The Canvas LMS assignment a chat was opened for (an LTI launch from the assignment).
export type CanvasLmsAssignment = {
  title: string;
  course: string;
  course_code: string;
  // The module item's title in Canvas LMS, e.g. "Unit 3: Fractions practice".
  link_title: string;
  due_at: string;
  due_label: string;
  points: string;
  attempts_used: string;
  attempts_allowed: string;
  // Plain text from the assignment's description. Goes to the tutor as data, never as instructions.
  instructions: string;
  // Empty when Canvas LMS gave no way to send work back (a teacher's launch, or an ungraded link).
  turn_in_id: string;
  turned_in_at: string;
};

export type WorkCheckStatus = "correct" | "incomplete" | "error" | "blank" | "unreadable";
export type WorkCheckRecord = { label: string; status: WorkCheckStatus };

export type CanvasLmsCourse = { name: string; code: string; sections: string[]; start_at: string; end_at: string };

// What Canvas LMS said about the student at their last launch. Shown on the profile, not sent to the tutor.
export type CanvasLmsInfo = {
  name: string;
  photo_url: string;
  roles: string[];
  enrollment_state: string;
  school: string;
  courses: CanvasLmsCourse[];
  linked_at: number;
};

// One run of the board with one tutor, with its own homework. The left sidebar lists these.
export type Conversation = {
  id: string;
  tutor_id: string;
  title: string;
  created_at: number;
  messages: ChatMessage[];
  document: LgDocument | null;
  canvas_lms_assignment?: CanvasLmsAssignment | null;
  // Check my work results in this chat, for the summary turned in to Canvas LMS.
  work_checks?: WorkCheckRecord[];
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
