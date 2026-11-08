"use client";

import { useSyncExternalStore } from "react";
import type {
  CanvasLmsAssignment,
  CanvasLmsInfo,
  ChatMessage,
  ChatSpeaker,
  Conversation,
  LgBoardQuestion,
  LgBoardSelection,
  LgDocument,
  StudentProfile,
  Tutor,
  WorkCheckRecord,
} from "./lg-types";
import { DEFAULT_TUTOR_ID, migrateLgState, PRESET_TUTORS, PRESETS_VERSION } from "./lg-presets";

// Browser-only storage for the mock. FastAPI and Postgres replace this later.
const STORAGE_KEY = "lg-state-v1";

const TITLE_MAX = 48;
const PRACTICE_HISTORY_MAX = 10;
const BOARD_ITEMS_MAX = 20;

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
  // Which starter tutors this save has seen (lg-presets.ts). A save without it is version 1.
  presets_version: number;
};

const DEFAULT_STATE: LgState = {
  // The three presets from the vision doc, section 4.2.
  tutors: [...PRESET_TUTORS],
  active_tutor_id: DEFAULT_TUTOR_ID,
  profile: { name: "", school: "", courses: "", language: "", struggles: "", upcoming: "" },
  conversations: [],
  active_conversation_id: null,
  draft_id: "",
  canvas_lms: null,
  presets_version: PRESETS_VERSION,
};

let cached: LgState | null = null;
const listeners = new Set<() => void>();

export function readLgState(): LgState {
  if (cached) return cached;
  let migrated = false;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    // Before the defaults are merged in, or their presets_version would hide an old save.
    const saved = migrateLgState(parsed);
    migrated = saved !== parsed;
    // Profiles saved before a field existed get its default instead of undefined.
    cached = saved ? { ...DEFAULT_STATE, ...saved, profile: { ...DEFAULT_STATE.profile, ...saved.profile } } : DEFAULT_STATE;
  } catch {
    cached = DEFAULT_STATE;
  }
  const loaded = cached as LgState;
  if (!loaded.draft_id) cached = { ...loaded, draft_id: crypto.randomUUID() };
  // Saved without notifying anyone: this runs during render.
  if (migrated || !loaded.draft_id) saveLgState(cached as LgState);
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

// Picking a tutor on the Tutors page. A chat already under way stays with its tutor in history,
// and the new tutor starts fresh on the start screen. A chat with no conversation yet (only
// homework or drawing) moves to the new tutor, so that work isn't lost.
export function chooseTutor(id: string) {
  const state = readLgState();
  const active = getActiveConversation(state);
  if (!active || active.tutor_id === id) {
    writeLgState({ ...state, active_tutor_id: id });
    return;
  }
  const talkedAlready = active.messages.some((message) => message.who !== "system");
  writeLgState(
    talkedAlready
      ? { ...state, active_tutor_id: id, active_conversation_id: null }
      : {
          ...state,
          active_tutor_id: id,
          conversations: state.conversations.map((item) => (item.id === active.id ? { ...item, tutor_id: id } : item)),
        },
  );
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

// Questions the tutor wrote on the open chat's board (lg-actions.ts writes them).
export function getBoardQuestions(state: LgState): LgBoardQuestion[] {
  return getActiveConversation(state)?.board_questions ?? [];
}

export function findBoardQuestion(state: LgState, id: string): LgBoardQuestion | undefined {
  return getBoardQuestions(state).find((question) => question.id === id);
}

// Adds a question under the next free ID (q1, q2, ...) and returns it. Its text also goes in the
// chat's practice history, which clear leaves alone.
export function addBoardQuestion(conversation_id: string, make: (id: string) => LgBoardQuestion): LgBoardQuestion | null {
  const conversation = readLgState().conversations.find((item) => item.id === conversation_id);
  if (!conversation) return null;
  const count = (conversation.board_question_count ?? 0) + 1;
  const question = make(`q${count}`);
  updateConversation(conversation_id, (item) => ({
    ...item,
    board_question_count: count,
    board_questions: [...(item.board_questions ?? []), question].slice(-BOARD_ITEMS_MAX),
    practice_history: [...(item.practice_history ?? []), question.text].slice(-PRACTICE_HISTORY_MAX),
  }));
  return question;
}

export function updateBoardQuestion(conversation_id: string, id: string, patch: Partial<Omit<LgBoardQuestion, "id">>) {
  updateConversation(conversation_id, (item) => ({
    ...item,
    board_questions: (item.board_questions ?? []).map((question) => (question.id === id ? { ...question, ...patch } : question)),
  }));
}

// The tutor cleared its marks, so these questions are gone from the board too. Only the ones that
// were there when it asked: a question it writes straight after clear must survive the fade-out.
export function clearBoardQuestions(conversation_id: string, ids: readonly string[]) {
  if (!ids.length) return;
  updateConversation(conversation_id, (item) =>
    item.board_questions?.some((question) => ids.includes(question.id))
      ? { ...item, board_questions: item.board_questions.filter((question) => !ids.includes(question.id)) }
      : item,
  );
}

// Spots the student circled on the open chat's board (lg-actions.ts saves them).
export function getBoardSelections(state: LgState): LgBoardSelection[] {
  return getActiveConversation(state)?.board_selections ?? [];
}

export function findBoardSelection(state: LgState, id: string): LgBoardSelection | undefined {
  return getBoardSelections(state).find((selection) => selection.id === id);
}

// Adds a circled spot under the next free ID (s1, s2, ...) and returns it. The oldest go past 20.
export function addBoardSelection(conversation_id: string, make: (id: string) => LgBoardSelection): LgBoardSelection | null {
  const conversation = readLgState().conversations.find((item) => item.id === conversation_id);
  if (!conversation) return null;
  const count = (conversation.board_selection_count ?? 0) + 1;
  const selection = make(`s${count}`);
  updateConversation(conversation_id, (item) => ({
    ...item,
    board_selection_count: count,
    board_selections: [...(item.board_selections ?? []), selection].slice(-BOARD_ITEMS_MAX),
  }));
  return selection;
}

// The tutor cleared the board, which takes the student's circles with it.
export function clearBoardSelections(conversation_id: string, ids: readonly string[]) {
  if (!ids.length) return;
  updateConversation(conversation_id, (item) =>
    item.board_selections?.some((selection) => ids.includes(selection.id))
      ? { ...item, board_selections: item.board_selections.filter((selection) => !ids.includes(selection.id)) }
      : item,
  );
}

// Some circles went with the file they were on. Their IDs aren't given out again.
export function removeBoardSelections(conversation_id: string, ids: string[]) {
  if (!ids.length) return;
  updateConversation(conversation_id, (item) => ({
    ...item,
    board_selections: (item.board_selections ?? []).filter((selection) => !ids.includes(selection.id)),
  }));
}
