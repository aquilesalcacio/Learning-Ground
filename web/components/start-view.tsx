"use client";

import { Upload } from "lucide-react";
import Link from "next/link";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { MockBadge } from "@/components/lg-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LG_PAGES, LG_REGIONS } from "@/lib/lg-regions";
import { setActiveTutor, setLgDocument, useLgState } from "@/lib/lg-store";
import { COLOR_HEX, LANGUAGE_OPTIONS, optionLabel, TONE_OPTIONS } from "@/lib/lg-types";

const MOCK_PROCESSING_MS = 1500;

export function StartView() {
  const state = useLgState();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("That file isn't a PDF. Choose a PDF.");
      return;
    }
    setError("");
    setLgDocument(null);
    setProcessing(true);
    timer.current = setTimeout(() => {
      setLgDocument({ filename: file.name, page_count: LG_PAGES.length, status: "ready" });
      setProcessing(false);
    }, MOCK_PROCESSING_MS);
  }

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 p-4 sm:p-8">
      <div>
        <h1 className="text-2xl font-semibold">Start a session</h1>
        <p className="text-muted-foreground">Pick a tutor, add your homework, then work through it together.</p>
      </div>

      <section className="grid gap-3" aria-labelledby="choose-tutor">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="choose-tutor" className="text-lg font-medium">
            1. Choose a tutor
          </h2>
          <Link href="/tutors" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Manage tutors
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {state.tutors.map((tutor) => (
            <button
              key={tutor.id}
              type="button"
              aria-pressed={tutor.id === state.active_tutor_id}
              onClick={() => setActiveTutor(tutor.id)}
              className="rounded-lg border p-4 text-left aria-pressed:border-foreground aria-pressed:ring-1 aria-pressed:ring-foreground"
            >
              <span className="flex items-center gap-2 font-medium">
                <span
                  aria-hidden="true"
                  className="size-3 rounded-full"
                  style={{ backgroundColor: COLOR_HEX[tutor.color] }}
                />
                {tutor.name || "Unnamed tutor"}
              </span>
              <span className="mt-1 block text-sm text-muted-foreground">
                {optionLabel(LANGUAGE_OPTIONS, tutor.language)} · {optionLabel(TONE_OPTIONS, tutor.tone)}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="add-homework">
        <Card>
          <CardHeader>
            <CardTitle id="add-homework" className="flex flex-wrap items-center gap-2 text-lg">
              2. Add your homework <MockBadge label="Regions mocked" />
            </CardTitle>
            <CardDescription>
              A PDF of up to about 10 pages. Download it from Canvas LMS, then upload it here.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed p-8 text-center focus-within:ring-2 focus-within:ring-ring">
              <Upload aria-hidden="true" className="size-5 text-muted-foreground" />
              <span className="font-medium">Choose a PDF</span>
              <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={onFile} />
            </label>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {processing && (
              <p role="status" className="text-sm text-muted-foreground">
                Detecting regions...
              </p>
            )}
            {state.document && (
              <div className="grid gap-2 rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium break-all">{state.document.filename}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setLgDocument(null)}>
                    Remove
                  </Button>
                </div>
                <p className="text-muted-foreground">
                  {LG_REGIONS.length} placeholder regions across {state.document.page_count} placeholder pages. The
                  PDF itself isn&apos;t read yet.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3" aria-labelledby="open-board">
        <h2 id="open-board" className="text-lg font-medium">
          3. Open it
        </h2>
        <div>
          <Link href="/learning-grounds" className={buttonVariants({ size: "lg" })}>
            Open Learning Grounds
          </Link>
        </div>
      </section>
    </div>
  );
}
