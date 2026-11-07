import catalog from "./voice-catalog.json";
import type { LgLanguage, Option } from "./lg-types";

// voice-catalog.json is written by api/scripts/elevenlabs_setup.py. GET /voices replaces it later (T-305).
export type CatalogVoice = {
  voice_id: string;
  name: string;
  gender: string | null;
  accent: string | null;
  locale: string | null;
  preview_url: string | null;
};

const voices = catalog as Record<LgLanguage, CatalogVoice[]>;

export function voiceOptions(language: LgLanguage | ""): Option<string>[] {
  if (!language) return [];
  return voices[language].map((voice) => ({ value: voice.voice_id, label: voice.name }));
}

export function findVoice(language: LgLanguage | "", voice_id: string): CatalogVoice | undefined {
  if (!language) return undefined;
  return voices[language].find((voice) => voice.voice_id === voice_id);
}

export function defaultVoice(language: LgLanguage | ""): CatalogVoice | undefined {
  return language ? voices[language][0] : undefined;
}
