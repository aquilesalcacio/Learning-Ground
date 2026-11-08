"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MockBadge } from "@/components/lg-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { chooseTutor, createTutor, useLgState } from "@/lib/lg-store";
import { COLOR_HEX, LANGUAGE_OPTIONS, optionLabel, STYLE_OPTIONS, TONE_OPTIONS } from "@/lib/lg-types";

export function TutorsView() {
  const state = useLgState();
  const router = useRouter();

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tutors</h1>
          <p className="text-muted-foreground">Design who you want to learn with.</p>
        </div>
        <Button type="button" onClick={() => router.push(`/tutors/${createTutor()}`)}>
          <Plus aria-hidden="true" />
          New tutor
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {state.tutors.map((tutor) => (
          <Card key={tutor.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: COLOR_HEX[tutor.color] }}
                />
                {tutor.name || "Unnamed tutor"}
                {tutor.is_preset && <MockBadge label="Preset" />}
              </CardTitle>
              <CardDescription>
                {optionLabel(LANGUAGE_OPTIONS, tutor.language)} · {optionLabel(TONE_OPTIONS, tutor.tone)}
                <br />
                {optionLabel(STYLE_OPTIONS, tutor.style)}
              </CardDescription>
            </CardHeader>
            <CardFooter className="mt-auto flex flex-wrap gap-2">
              <Link href={`/tutors/${tutor.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Edit
              </Link>
              <Button
                type="button"
                variant={tutor.id === state.active_tutor_id ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={tutor.id === state.active_tutor_id}
                onClick={() => {
                  // Picking a tutor takes the student straight back to them on the board.
                  chooseTutor(tutor.id);
                  router.push("/");
                }}
              >
                {tutor.id === state.active_tutor_id ? "Selected" : "Select"}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
