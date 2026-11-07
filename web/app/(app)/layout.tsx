import { type ReactNode, Suspense } from "react";
import { AppShell } from "@/components/app-shell";

// Everything behind login shares the sidebar. A login page can sit outside this group, at app/login.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
