import type { Tutor } from "./lg-types";

// The starter tutors, and the one-time upgrade for browsers that saved the old ones.
// No React or JSON imports here, so node --test can load it (lg-presets.test.ts).

// Bump this when the presets change, and teach migrateLgState the step. Saves without it are version 1.
export const PRESETS_VERSION = 2;

// The IDs are historical: they come from the first presets (Prof. Ana, Don Mateo and Sam).
// Chats store tutor_id, so a preset keeps its ID when it's renamed.
export const DEFAULT_TUTOR_ID = "sam";

function preset(
  id: string,
  name: string,
  color: Tutor["color"],
  language: Tutor["language"],
  tone: Tutor["tone"],
  voice_id: string,
): Tutor {
  return { id, name, color, language, tone, voice_id, style: "", persona_prompt: "", is_preset: true };
}

// In the order the Tutors page lists them. Voices are from voice-catalog.json; the test checks they're there.
export const PRESET_TUTORS: readonly Tutor[] = [
  // Tony, Lorenzo's pick.
  preset("sam", "Prof. Sam", "green", "en", "humorous", "6RKusXyh27gM03F5pxPX"),
  // Sofia, the only female Portuguese voice in the catalog.
  preset("prof-ana", "Prof. Luisa", "blue", "pt", "casual", "n2a9VtkZLl8j1FSXHsL7"),
  // Cristóbal.
  preset("don-mateo", "Prof. Erik", "red", "es", "formal", "IhY4M972n9BRInNffBsN"),
];

// Names from version 1. A preset still called one of these was never renamed by the student.
const VERSION_1_NAMES: Record<string, string> = { "prof-ana": "Prof. Ana", "don-mateo": "Don Mateo", sam: "Sam" };

type MigratedFields = { presets_version: number; active_tutor_id: string; active_conversation_id: string | null };
type Migrated<T> = T extends Record<string, unknown> ? T & MigratedFields : T;

function defaultTutor(): Tutor {
  return PRESET_TUTORS.find((tutor) => tutor.id === DEFAULT_TUTOR_ID)!;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Brings a parsed lg-state-v1 save up to PRESETS_VERSION. Run it on the raw save, before the
// defaults are merged in, or the default version would hide an old save. Returns the same object
// when there's nothing to do, so the caller can tell whether to save, and never edits the input.
export function migrateLgState<T>(saved: T): Migrated<T> {
  if (!isRecord(saved)) return saved as Migrated<T>;
  const version = typeof saved.presets_version === "number" ? saved.presets_version : 1;
  if (version >= PRESETS_VERSION) return saved as Migrated<T>;

  const next: Record<string, unknown> = {
    ...saved,
    presets_version: PRESETS_VERSION,
    // Sam takes over, and the open chat closes so a Portuguese chat doesn't go on in English.
    // Old chats stay in the sidebar with their own tutors.
    active_tutor_id: DEFAULT_TUTOR_ID,
    active_conversation_id: null,
  };
  // A save with no tutor list gets the defaults when it's merged.
  if (Array.isArray(saved.tutors)) next.tutors = upgradePresets(saved.tutors as Tutor[]);
  return next as Migrated<T>;
}

function upgradePresets(tutors: Tutor[]): Tutor[] {
  const upgraded = tutors.map((tutor) => {
    const fresh = tutor.is_preset ? PRESET_TUTORS.find((item) => item.id === tutor.id) : undefined;
    if (!fresh) return tutor;
    const rename = tutor.name === VERSION_1_NAMES[tutor.id];
    // A preset moved to another language keeps the blank voice: this one would be the wrong language.
    const voiced = !tutor.voice_id && tutor.language === fresh.language;
    if (!rename && !voiced) return tutor;
    return { ...tutor, ...(rename ? { name: fresh.name } : {}), ...(voiced ? { voice_id: fresh.voice_id } : {}) };
  });
  // Presets can't be deleted, but a damaged save could still lack Sam, who is now the active tutor.
  const sam = upgraded.find((tutor) => tutor.id === DEFAULT_TUTOR_ID) ?? { ...defaultTutor() };
  return [sam, ...upgraded.filter((tutor) => tutor !== sam)];
}
