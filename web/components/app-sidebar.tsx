"use client";

import { GraduationCap, PanelLeftClose, Plus, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TUTOR_PALETTES } from "@/lib/lg-palette";
import {
  conversationTitle,
  deleteConversation,
  newChat,
  setActiveConversation,
  sortedConversations,
  useHydrated,
  useLgState,
} from "@/lib/lg-store";

// Loaded on demand so the board library stays off pages that have no board.
const TutorActions = dynamic(() => import("@/components/tutor-actions").then((module) => module.TutorActions));

function dayLabel(created_at: number) {
  return new Date(created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const ROW =
  "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm outline-none transition-[background-color,transform] duration-(--dur-base) ease-spring hover:bg-black/[0.04] focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-[0.98] aria-[current]:bg-black/[0.055] aria-[current]:font-medium";

// A solid, glossy white panel in the iPhone style: no see-through, no dividers, only what's needed.
export function AppSidebar({
  open,
  onClose,
  onNewChat,
}: {
  open: boolean;
  onClose: () => void;
  onNewChat: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const state = useLgState();
  const hydrated = useHydrated();
  const onBoard = pathname === "/";
  const conversations = hydrated ? sortedConversations(state) : [];
  const { name, school } = state.profile;
  const onTutors = pathname.startsWith("/tutors");
  const onProfile = pathname.startsWith("/profile");

  function startNewChat() {
    newChat();
    onNewChat();
    if (!onBoard) router.push("/");
  }

  function openChat(id: string) {
    setActiveConversation(id);
    // Off the board, arriving on it applies the board's own default, which is retracted.
    if (onBoard) onClose();
    else router.push("/");
  }

  return (
    <aside
      aria-label="Sidebar"
      aria-hidden={!open}
      inert={!open || undefined}
      className={`z-30 h-full shrink-0 overflow-hidden transition-[width] duration-300 ease-soft max-md:absolute max-md:inset-y-0 max-md:left-0 ${
        open ? "w-72" : "w-0"
      }`}
    >
      <div className="h-full w-72 p-2">
        <div className="surface-solid flex h-full flex-col rounded-[1.75rem] p-2">
          <div className="flex items-center justify-between gap-2 py-1.5 pr-1 pl-3">
            <span className="text-[0.95rem] font-semibold tracking-tight">Learning Grounds</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close sidebar"
              className="rounded-full text-muted-foreground"
              onClick={onClose}
            >
              <PanelLeftClose />
            </Button>
          </div>

          <nav aria-label="Main" className="grid gap-0.5 pt-2">
            <button type="button" className={ROW} onClick={startNewChat}>
              <Plus aria-hidden="true" className="size-4 text-muted-foreground" />
              New chat
            </button>
            <Link href="/tutors" aria-current={onTutors ? "page" : undefined} className={ROW}>
              <GraduationCap aria-hidden="true" className="size-4 text-muted-foreground" />
              Tutors
            </Link>
          </nav>

          <h2 className="px-3 pt-5 pb-1 text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">Chats</h2>
          <ul aria-label="Chats" className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-2">
            {conversations.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">Your chats will appear here.</li>
            )}
            {conversations.map((conversation) => {
              const tutor = state.tutors.find((item) => item.id === conversation.tutor_id);
              const palette = TUTOR_PALETTES[tutor?.color ?? "blue"];
              const active = onBoard && conversation.id === state.active_conversation_id;
              const title = conversationTitle(conversation);
              return (
                <li key={conversation.id} className="group relative">
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    className={`${ROW} pr-9`}
                    onClick={() => openChat(conversation.id)}
                  >
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: `radial-gradient(circle at 35% 30%, ${palette.c2}, ${palette.c1} 70%)` }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{title}</span>
                      <span className="block truncate text-xs font-normal text-muted-foreground">
                        {tutor?.name || "Unnamed tutor"} · {dayLabel(conversation.created_at)}
                      </span>
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Delete chat: ${title}`}
                    className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-full text-muted-foreground transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                    onClick={() => deleteConversation(conversation.id)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ul>

          {process.env.NODE_ENV === "development" && onBoard && <TutorActions />}

          {/* Placeholder details until login exists. This is the only way to the Student Profile. */}
          <Link
            href="/profile"
            aria-label="Student Profile"
            aria-current={onProfile ? "page" : undefined}
            className={`${ROW} mt-1 py-2.5`}
          >
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground"
            >
              {(name.trim()[0] ?? "S").toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{name.trim() || "Student"}</span>
              {school.trim() && <span className="block truncate text-xs text-muted-foreground">{school.trim()}</span>}
            </span>
          </Link>
        </div>
      </div>
    </aside>
  );
}
