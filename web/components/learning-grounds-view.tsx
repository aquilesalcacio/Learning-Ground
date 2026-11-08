"use client";

import dynamic from "next/dynamic";
import { BoardFiles } from "@/components/board-files";
import { ChatDock } from "@/components/chat-dock";
import { useHydrated, useLgState } from "@/lib/lg-store";

const LgBoard = dynamic(() => import("@/components/lg-board"), { ssr: false });

// The start screen and the working board are one screen. The tutor orb sits in the middle
// until a chat begins (first message, upload, stroke or voice session), then docks in the
// corner with the same board still underneath. The board is see-through, so the app's dot
// grid shows behind the student's work.
export function LearningGroundsView() {
  const state = useLgState();
  const hydrated = useHydrated();
  const boardId = state.active_conversation_id ?? state.draft_id;

  return (
    <div className="@container relative min-h-0 flex-1 overflow-hidden">
      {hydrated && <LgBoard key={boardId} boardId={boardId} />}
      {hydrated && <BoardFiles />}
      {hydrated && <ChatDock state={state} boardId={boardId} />}
    </div>
  );
}
