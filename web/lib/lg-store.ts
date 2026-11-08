"use client";

import { useSyncExternalStore } from "react";
import type {
  CanvasLmsAssignment,
  CanvasLmsInfo,
  ChatMessage,
  ChatSpeaker,
  Conversation,
  LgDocument,
  StudentProfile,
  Tutor,
  WorkCheckRecord,
} from "./lg-types";

// Browser-only storage for the mock. FastAPI and Postgres replace this later.
const STORAGE_KEY = "lg-state-v1";

const TITLE_MAX = 48;

export type LgState = {
  tutors: Tutor[];
  active_tutor_id: string;
  profile: StudentProfile;
  conversations: Conversation[];
  // Null means the start screen is showing.
  active_conversation_id: string | null;
  // The ID the next chat will take. The start screen's board is already saved under it,
  // so whatever the student draws there carries over when the chat begins.
  draft_id: string;
  canvas_lms: CanvasLmsInfo | null;
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
  profile: { name: "", school: "", courses: "", language: "", struggles: "", upcoming: "" },
  conversations: [],
  active_conversation_id: null,
  draft_id: "",
  canvas_lms: null,
};

let cached: LgState | null = null;
const listeners = new Set<() => void>();

export function readLgState(): LgState {
  if (cached) return cached;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    // Profiles saved before a field existed get its default instead of undefined.
    cached = saved ? { ...DEFAULT_STATE, ...saved, profile: { ...DEFAULT_STATE.profile, ...saved.profile } } : DEFAULT_STATE;
  } catch {
    cached = DEFAULT_STATE;
  }
  const loaded = cached as LgState;
  if (!loaded.draft_id) {
    cached = { ...loaded, draft_id: crypto.randomUUID() };
    saveLgState(cached);
  }
  return cached as LgState;
}

function saveLgState(next: LgState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private windows can refuse storage. The app keeps working for this session.
  }
}

function writeLgState(next: LgState) {
  cached = next;
  saveLgState(next);
  listeners.forEach((listener) => listener());
}

export function subscribeLgState(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLgState(): LgState {
  return useSyncExternalStore(subscribeLgState, readLgState, () => DEFAULT_STATE);
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

export function getActiveDocument(state: LgState): LgDocument | null {
  const document = getActiveConversation(state)?.document;
  return isCurrentDocument(document) ? document : null;
}

// A document saved before real page reading has no pages, and can't be shown.
function isCurrentDocument(document: LgDocument | null | undefined): document is LgDocument {
  return !!document && Array.isArray(document.pages) && Array.isArray(document.regions);
}

export function getConversationDocument(state: LgState, conversation_id: string): LgDocument | null {
  const document = state.conversations.find((item) => item.id === conversation_id)?.document;
  return isCurrentDocument(document) ? document : null;
}

// Adding homework begins a chat, if one hasn't begun already. Returns the chat's ID.
export function setLgDocument(document: LgDocument | null): string | null {
  const active = readLgState().active_conversation_id;
  if (!active && !document) return null;
  const id = active ?? startConversation();
  setConversationDocument(id, () => document);
  return id;
}

// Updates one chat's homework, whichever chat is on screen. Pages are read in the background,
// so a reading can land after the student has moved to another chat.
export function setConversationDocument(id: string, update: (current: LgDocument | null) => LgDocument | null) {
  const state = readLgState();
  writeLgState({
    ...state,
    conversations: state.conversations.map((item) =>
      item.id === id ? { ...item, document: update(isCurrentDocument(item.document) ? item.document : null) } : item,
    ),
  });
}

export function getActiveConversation(state: LgState): Conversation | null {
  return state.conversations.find((item) => item.id === state.active_conversation_id) ?? null;
}

// Newest first, which is the order the history sidebar shows them in.
export function sortedConversations(state: LgState): Conversation[] {
  return [...state.conversations].sort((a, b) => b.created_at - a.created_at);
}

export function startConversation(tutor_id?: string): string {
  const state = readLgState();
  const id = state.draft_id;
  const conversation: Conversation = {
    id,
    tutor_id: tutor_id ?? state.active_tutor_id,
    title: "",
    created_at: Date.now(),
    messages: [],
    document: null,
  };
  writeLgState({
    ...state,
    conversations: [...state.conversations, conversation],
    active_conversation_id: id,
    draft_id: crypto.randomUUID(),
  });
  return id;
}

// Back to the start screen. No chat is recorded until the student does something.
export function newChat() {
  writeLgState({ ...readLgState(), active_conversation_id: null });
}

export function setConversationTutor(id: string, tutor_id: string) {
  const state = readLgState();
  writeLgState({
    ...state,
    conversations: state.conversations.map((item) => (item.id === id ? { ...item, tutor_id } : item)),
  });
}

export function conversationTitle(conversation: Conversation): string {
  return conversation.title || conversation.document?.filename || "New chat";
}

export function boardPersistenceKey(conversation_id: string): string {
  return `lg-board-${conversation_id}`;
}

export function setActiveConversation(id: string) {
  const state = readLgState();
  const conversation = state.conversations.find((item) => item.id === id);
  if (!conversation) return;
  // Opening a past chat also restores the tutor it was held with.
  const active_tutor_id = state.tutors.some((tutor) => tutor.id === conversation.tutor_id)
    ? conversation.tutor_id
    : state.active_tutor_id;
  writeLgState({ ...state, active_conversation_id: id, active_tutor_id });
}

export function deleteConversation(id: string) {
  const state = readLgState();
  const conversations = state.conversations.filter((item) => item.id !== id);
  writeLgState({
    ...state,
    conversations,
    active_conversation_id: state.active_conversation_id === id ? null : state.active_conversation_id,
  });
  // tldraw names its database this way, in LocalIndexedDb.js. Check this if tldraw is upgraded.
  window.indexedDB?.deleteDatabase(`TLDRAW_DOCUMENT_v2${boardPersistenceKey(id)}`);
}

export function appendMessage(conversation_id: string, who: ChatSpeaker, text: string) {
  const state = readLgState();
  const message: ChatMessage = { id: crypto.randomUUID(), who, text };
  writeLgState({
    ...state,
    conversations: state.conversations.map((item) => {
      if (item.id !== conversation_id) return item;
      // The first thing the student says names the chat in the sidebar.
      const title = item.title || (who === "student" ? text.slice(0, TITLE_MAX) : "");
      return { ...item, title, messages: [...item.messages, message] };
    }),
  });
}

function updateConversation(id: string, update: (conversation: Conversation) => Conversation) {
  const state = readLgState();
  writeLgState({ ...state, conversations: state.conversations.map((item) => (item.id === id ? update(item) : item)) });
}

export function setCanvasLmsInfo(info: CanvasLmsInfo) {
  writeLgState({ ...readLgState(), canvas_lms: info });
}

// Opening an assignment from Canvas LMS starts a fresh chat about it, named after it.
export function startCanvasLmsAssignmentChat(assignment: CanvasLmsAssignment): string {
  const id = startConversation();
  updateConversation(id, (item) => ({ ...item, title: assignment.title.slice(0, TITLE_MAX), canvas_lms_assignment: assignment }));
  return id;
}

export function markCanvasLmsTurnedIn(conversation_id: string, turned_in_at: string) {
  updateConversation(conversation_id, (item) =>
    item.canvas_lms_assignment ? { ...item, canvas_lms_assignment: { ...item.canvas_lms_assignment, turned_in_at } } : item,
  );
}

// Check my work results in the open chat, for the session summary turned in to Canvas LMS.
export function recordWorkCheck(check: WorkCheckRecord) {
  const conversation = getActiveConversation(readLgState());
  if (!conversation) return;
  updateConversation(conversation.id, (item) => ({ ...item, work_checks: [...(item.work_checks ?? []), check].slice(-30) }));
}
