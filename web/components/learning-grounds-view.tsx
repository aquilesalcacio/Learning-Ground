"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { ChatDock } from "@/components/chat-dock";
import { HistorySidebar, HistoryTrigger } from "@/components/history-sidebar";
import { startConversation, useHydrated, useLgState } from "@/lib/lg-store";

const LgBoard = dynamic(() => import("@/components/lg-board"), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-muted-foreground">Loading board...</p>,
});

// The board fills the screen. The only things on top of it are the small figure
// that opens chat history and the chat dock along the bottom.
export function LearningGroundsView() {
  const state = useLgState();
  const hydrated = useHydrated();
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {hydrated && <LgBoard filename={state.document?.filename ?? null} />}

      <HistoryTrigger state={state} onOpen={() => setHistoryOpen(true)} />
      <HistorySidebar
        open={historyOpen}
        state={state}
        onClose={() => setHistoryOpen(false)}
        onNewChat={() => {
          startConversation();
          setHistoryOpen(false);
        }}
      />

      <ChatDock state={state} />
    </div>
  );
}
