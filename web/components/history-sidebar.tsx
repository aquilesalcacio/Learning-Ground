"use client";

import { PanelLeftClose, Plus, Trash2, UserRound } from "lucide-react";
import Link from "next/link";
import { TutorActions } from "@/components/tutor-actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  deleteConversation,
  getActiveTutor,
  type LgState,
  setActiveConversation,
  sortedConversations,
} from "@/lib/lg-store";
import { COLOR_HEX } from "@/lib/lg-types";

const NAV_LINKS = [
  { href: "/", label: "Start" },
  { href: "/tutors", label: "Tutors" },
  { href: "/profile", label: "Student Profile" },
];

function dayLabel(created_at: number) {
  return new Date(created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Slides in over the board from the small figure button, so chat history costs
// no permanent screen space.
export function HistorySidebar({
  open,
  state,
  onClose,
  onNewChat,
}: {
  open: boolean;
  state: LgState;
  onClose: () => void;
  onNewChat: () => void;
}) {
  const conversations = sortedConversations(state);

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close chat history"
          tabIndex={-1}
          className="absolute inset-0 z-20 cursor-default bg-black/20"
          onClick={onClose}
        />
      )}
      <aside
        aria-label="Chat history"
        aria-hidden={!open}
        inert={!open || undefined}
        className={`absolute inset-y-0 left-0 z-30 flex w-72 flex-col border-r bg-background transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-2 p-3">
          <h2 className="text-sm font-medium">Chat history</h2>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close chat history" onClick={onClose}>
            <PanelLeftClose />
          </Button>
        </div>

        <div className="px-3 pb-2">
          <Button type="button" variant="outline" size="sm" className="w-full justify-start" onClick={onNewChat}>
            <Plus aria-hidden="true" />
            New chat
          </Button>
        </div>

        <Separator />

        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {conversations.length === 0 && (
            <li className="p-2 text-sm text-muted-foreground">No chats yet. Say something to your tutor.</li>
          )}
          {conversations.map((conversation) => {
            const tutor = state.tutors.find((item) => item.id === conversation.tutor_id);
            const active = conversation.id === state.active_conversation_id;
            return (
              <li key={conversation.id} className="flex items-center gap-1">
                <Button
                  type="button"
                  variant={active ? "secondary" : "ghost"}
                  aria-current={active ? "true" : undefined}
                  className="h-auto min-w-0 flex-1 justify-start py-1.5 text-left"
                  onClick={() => {
                    setActiveConversation(conversation.id);
                    onClose();
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: COLOR_HEX[tutor?.color ?? "blue"] }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{conversation.title || "New chat"}</span>
                    <span className="block truncate text-xs font-normal text-muted-foreground">
                      {tutor?.name || "Unnamed tutor"} · {dayLabel(conversation.created_at)}
                    </span>
                  </span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete chat: ${conversation.title || "New chat"}`}
                  onClick={() => deleteConversation(conversation.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>

        <Separator />

        <TutorActions />

        <Separator />

        <nav aria-label="Main" className="grid gap-0.5 p-2">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={buttonVariants({ variant: "ghost", size: "sm", className: "justify-start" })}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </aside>
    </>
  );
}

// The small figure that opens the sidebar. Shows the active tutor's color so it
// doubles as a session indicator.
export function HistoryTrigger({ state, onOpen }: { state: LgState; onOpen: () => void }) {
  const tutor = getActiveTutor(state);

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label="Open chat history"
      title="Chat history"
      className="absolute top-3 left-3 z-10 rounded-full shadow-sm"
      onClick={onOpen}
    >
      <UserRound style={{ color: COLOR_HEX[tutor.color] }} />
    </Button>
  );
}
