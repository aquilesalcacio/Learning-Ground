"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { claimCanvasLmsLaunch } from "@/lib/lg-canvas-lms";

// Where Canvas LMS sends a student who opened Learning Grounds from a course (after Auth0 login).
// It collects what Canvas LMS sent, then opens the assignment's chat or the Student Profile.
export function CanvasLmsLaunchView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [code] = useState(() => searchParams.get("code") ?? "");
  const [error, setError] = useState(code ? "" : "This link is missing its Canvas LMS launch. Open Learning Grounds from Canvas LMS again.");
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !code) return; // Strict Mode runs effects twice in development.
    started.current = true;
    void claimCanvasLmsLaunch(code).then((result) => {
      if (result.ok) router.replace(result.value.to);
      else setError(result.message);
    });
  }, [code, router]);

  return (
    <div className="mx-auto grid w-full max-w-md gap-4 p-8 text-center">
      {error ? (
        <>
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <Link href="/profile" className={buttonVariants({ variant: "outline" })}>
            Go to your Student Profile
          </Link>
        </>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          Opening Learning Grounds from Canvas LMS…
        </p>
      )}
    </div>
  );
}
