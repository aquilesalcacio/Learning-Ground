"use client";

import dynamic from "next/dynamic";
import { ChatDock } from "@/components/chat-dock";
import { useHydrated, useLgState } from "@/lib/lg-store";

const LgBoard = dynamic(() => import("@/components/lg-board"), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-muted-foreground">Loading board...</p>,
});

// The start screen and the working board are one screen. A chat begins with the first
// message, upload or stroke, and the greeting leaves with the same board still underneath.
export function LearningGroundsView() {
  const state = useLgState();
  const hydrated = useHydrated();
  const boardId = state.active_conversation_id ?? state.draft_id;
  const name = state.profile.name.trim();

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {hydrated && <LgBoard key={boardId} boardId={boardId} />}

      {hydrated && !state.active_conversation_id && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6 pb-32">
          <h1 className="text-center text-3xl font-semibold text-balance">
            {name ? `Hi ${name}, what are we working on?` : "What are we working on?"}
          </h1>
        </div>
      )}

      <ChatDock state={state} boardId={boardId} />
    </div>
  );
}
