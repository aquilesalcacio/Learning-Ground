"use client";

import { PanelLeftOpen } from "lucide-react";
import { usePathname } from "next/navigation";
import { type ReactNode, useState, useSyncExternalStore } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { useHydrated, useLgState } from "@/lib/lg-store";

const DESKTOP_QUERY = "(min-width: 768px)";

function subscribeDesktop(listener: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function useIsDesktop() {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );
}

// The sidebar is open while the student is choosing what to do, and out of the way once they work.
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const state = useLgState();
  const hydrated = useHydrated();
  const isDesktop = useIsDesktop();
  const onBoard = pathname === "/";

  // A choice only lasts for the page it was made on. Each page then starts from its own default.
  const [choice, setChoice] = useState<{ pathname: string; open: boolean } | null>(null);
  const openByDefault = isDesktop && !(onBoard && state.active_conversation_id);
  const open = hydrated && (choice?.pathname === pathname ? choice.open : openByDefault);

  function setOpen(next: boolean) {
    setChoice({ pathname, open: next });
  }

  // Using anything on the board, or the chat bar and its menus, means work has started.
  function retract() {
    if (onBoard && open) setOpen(false);
  }

  return (
    <div className="relative flex h-full overflow-hidden">
      {open && !isDesktop && (
        <button
          type="button"
          aria-label="Close sidebar"
          tabIndex={-1}
          className="absolute inset-0 z-20 cursor-default bg-black/20"
          onClick={() => setOpen(false)}
        />
      )}

      <AppSidebar
        open={open}
        onClose={() => setOpen(false)}
        onNewChat={() => setOpen(isDesktop)}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        {hydrated && !open && (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Open sidebar"
            title="Open sidebar"
            className="absolute top-3 left-3 z-10 rounded-full bg-background shadow-sm"
            onClick={() => setOpen(true)}
          >
            <PanelLeftOpen />
          </Button>
        )}
        <main
          className={`flex min-h-0 flex-1 flex-col ${onBoard ? "overflow-hidden" : "overflow-y-auto max-md:pt-10"}`}
          onPointerDownCapture={retract}
          onKeyDownCapture={retract}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
