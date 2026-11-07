"use client";

import { useSyncExternalStore } from "react";
import type { LgDocument, StudentProfile, Tutor } from "./lg-types";

// Browser-only storage for the mock. FastAPI and Postgres replace this later.
const STORAGE_KEY = "lg-state-v1";

export type LgState = {
  tutors: Tutor[];
  active_tutor_id: string;
  profile: StudentProfile;
  document: LgDocument | null;
};

function preset(id: string, name: string, color: Tutor["color"], language: Tutor["language"], tone: Tutor["tone"]): Tutor {
  return { id, name, color, language, tone, voice_id: "", style: "", persona_prompt: "", is_preset: true };
}

const DEFAULT_STATE: LgState = {
  // The three presets suggested in the vision doc, section 4.2.
  tutors: [
    preset("prof-ana", "Prof. Ana", "blue", "pt", "casual"),
    preset("don-mateo", "Don Mateo", "red", "es", "formal"),
    preset("sam", "Sam", "green", "en", "humorous"),
  ],
  active_tutor_id: "prof-ana",
  profile: { name: "", school: "", courses: "", language: "", struggles: "" },
  document: null,
};

let cached: LgState | null = null;
const listeners = new Set<() => void>();

export function readLgState(): LgState {
  if (cached) return cached;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    cached = raw ? { ...DEFAULT_STATE, ...JSON.parse(raw) } : DEFAULT_STATE;
  } catch {
    cached = DEFAULT_STATE;
  }
  return cached as LgState;
}

function writeLgState(next: LgState) {
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private windows can refuse storage. The app keeps working for this session.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLgState(): LgState {
  return useSyncExternalStore(subscribe, readLgState, () => DEFAULT_STATE);
}

const noSubscribe = () => () => {};

export function useHydrated(): boolean {
  return useSyncExternalStore(noSubscribe, () => true, () => false);
}

export function getActiveTutor(state: LgState): Tutor {
  return state.tutors.find((tutor) => tutor.id === state.active_tutor_id) ?? state.tutors[0];
}

export function setActiveTutor(id: string) {
  writeLgState({ ...readLgState(), active_tutor_id: id });
}

export function updateTutor(id: string, patch: Partial<Tutor>) {
  const state = readLgState();
  writeLgState({
    ...state,
    tutors: state.tutors.map((tutor) => (tutor.id === id ? { ...tutor, ...patch } : tutor)),
  });
}

export function createTutor(): string {
  const id = crypto.randomUUID();
  const state = readLgState();
  const blank: Tutor = {
    id,
    name: "",
    color: "violet",
    voice_id: "",
    language: "",
    tone: "",
    style: "",
    persona_prompt: "",
    is_preset: false,
  };
  writeLgState({ ...state, tutors: [...state.tutors, blank] });
  return id;
}

export function deleteTutor(id: string) {
  const state = readLgState();
  const tutors = state.tutors.filter((tutor) => tutor.id !== id || tutor.is_preset);
  const active_tutor_id = tutors.some((tutor) => tutor.id === state.active_tutor_id)
    ? state.active_tutor_id
    : tutors[0].id;
  writeLgState({ ...state, tutors, active_tutor_id });
}

export function updateProfile(patch: Partial<StudentProfile>) {
  const state = readLgState();
  writeLgState({ ...state, profile: { ...state.profile, ...patch } });
}

export function setLgDocument(document: LgDocument | null) {
  writeLgState({ ...readLgState(), document });
}
