"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";

const LINKS = [
  { href: "/", label: "Start" },
  { href: "/learning-grounds", label: "Learning Grounds" },
  { href: "/tutors", label: "Tutors" },
  { href: "/chat", label: "Chat" },
  { href: "/profile", label: "Student Profile" },
];

export function AppNav() {
  const pathname = usePathname();

  // The board is full-bleed. Its own left sidebar carries these links instead.
  if (pathname.startsWith("/learning-grounds")) return null;

  return (
    <header className="flex min-h-14 flex-wrap items-center gap-x-6 gap-y-1 border-b px-4 py-2">
      <Link href="/" className="font-semibold">
        Learning Grounds
      </Link>
      <nav aria-label="Main" className="flex flex-wrap gap-1">
        {LINKS.map((link) => {
          const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={buttonVariants({ variant: active ? "secondary" : "ghost", size: "sm" })}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
