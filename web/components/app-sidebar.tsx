"use client";

import { useUser } from "@auth0/nextjs-auth0";
import { GraduationCap, PanelLeftClose, Plus, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  conversationTitle,
  deleteConversation,
  newChat,
  setActiveConversation,
  sortedConversations,
  useHydrated,
  useLgState,
} from "@/lib/lg-store";
import { COLOR_HEX } from "@/lib/lg-types";

// Loaded on demand so the board library stays off pages that have no board.
const TutorActions = dynamic(() => import("@/components/tutor-actions").then((module) => module.TutorActions));

function dayLabel(created_at: number) {
  return new Date(created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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
  const { user } = useUser();
  // The name the student typed (or imported) wins; Auth0's is the fallback.
  const displayName = name.trim() || user?.name?.trim() || "";

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
      className={`z-30 h-full shrink-0 overflow-hidden bg-background transition-[width] duration-200 max-md:absolute max-md:inset-y-0 max-md:left-0 ${
        open ? "w-72 border-r" : "w-0"
      }`}
    >
      <div className="flex h-full w-72 flex-col">
        <div className="flex items-center justify-between gap-2 p-3">
          <span className="font-semibold">Learning Grounds</span>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close sidebar" onClick={onClose}>
            <PanelLeftClose />
          </Button>
        </div>

        <nav aria-label="Main" className="grid gap-0.5 px-2 pb-2">
          <Button type="button" variant="ghost" size="sm" className="justify-start" onClick={startNewChat}>
            <Plus aria-hidden="true" />
            New chat
          </Button>
          <Link
            href="/tutors"
            aria-current={pathname.startsWith("/tutors") ? "page" : undefined}
            className={buttonVariants({
              variant: pathname.startsWith("/tutors") ? "secondary" : "ghost",
              size: "sm",
              className: "justify-start",
            })}
          >
            <GraduationCap aria-hidden="true" />
            Tutors
          </Link>
        </nav>

        <Separator />

        <h2 className="px-4 pt-3 pb-1 text-xs text-muted-foreground">Chats</h2>
        <ul aria-label="Chats" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {conversations.length === 0 && (
            <li className="p-2 text-sm text-muted-foreground">No chats yet. Say something to your tutor.</li>
          )}
          {conversations.map((conversation) => {
            const tutor = state.tutors.find((item) => item.id === conversation.tutor_id);
            const active = onBoard && conversation.id === state.active_conversation_id;
            const title = conversationTitle(conversation);
            return (
              <li key={conversation.id} className="flex items-center gap-1">
                <Button
                  type="button"
                  variant={active ? "secondary" : "ghost"}
                  aria-current={active ? "true" : undefined}
                  className="h-auto min-w-0 flex-1 justify-start py-1.5 text-left"
                  onClick={() => openChat(conversation.id)}
                >
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: COLOR_HEX[tutor?.color ?? "blue"] }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{title}</span>
                    <span className="block truncate text-xs font-normal text-muted-foreground">
                      {tutor?.name || "Unnamed tutor"} · {dayLabel(conversation.created_at)}
                    </span>
                  </span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete chat: ${title}`}
                  onClick={() => deleteConversation(conversation.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>

        {process.env.NODE_ENV === "development" && onBoard && (
          <>
            <Separator />
            <TutorActions />
          </>
        )}

        <Separator />

        {/* The logged-in student (Auth0). This is the only way to the Student Profile. */}
        <Link
          href="/profile"
          aria-label="Student Profile"
          aria-current={pathname.startsWith("/profile") ? "page" : undefined}
          className="flex items-center gap-2.5 p-3 outline-none hover:bg-muted focus-visible:bg-muted aria-[current=page]:bg-muted"
        >
          {user?.picture ? (
            // eslint-disable-next-line @next/next/no-img-element -- Auth0 avatars come from many hosts.
            <img src={user.picture} alt="" referrerPolicy="no-referrer" className="size-8 shrink-0 rounded-full" />
          ) : (
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground"
            >
              {(displayName[0] ?? "S").toUpperCase()}
            </span>
          )}
          <span className="min-w-0 flex-1 text-sm">
            <span className="block truncate font-medium">{displayName || "Student"}</span>
            {school.trim() && <span className="block truncate text-xs text-muted-foreground">{school.trim()}</span>}
          </span>
        </Link>
        {user && (
          // A full page load, not a client route: Auth0 clears the session and comes back to the start.
          <a href="/auth/logout" className={buttonVariants({ variant: "ghost", size: "sm", className: "mx-3 mb-3" })}>
            Log out
          </a>
        )}
      </div>
    </aside>
  );
}
