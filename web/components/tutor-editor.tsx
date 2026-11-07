"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ColorSwatches, FieldSelect, MockBadge } from "@/components/lg-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { deleteTutor, updateTutor, useHydrated, useLgState } from "@/lib/lg-store";
import { LANGUAGE_OPTIONS, STYLE_OPTIONS, TONE_OPTIONS, TUTOR_COLORS, VOICE_OPTIONS } from "@/lib/lg-types";

// The locked core from the vision doc, section 5. Students can read it but not edit it.
const LOCKED_CORE = [
  "Guide first.",
  "Never give a final answer before the student attempts it.",
  "Check the student's work.",
  "Use the hidden brief without reciting it.",
];

export function TutorEditor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const state = useLgState();
  const hydrated = useHydrated();
  const tutor = state.tutors.find((item) => item.id === id);

  if (!hydrated) return <p className="p-8 text-sm text-muted-foreground">Loading tutor...</p>;

  if (!tutor) {
    return (
      <div className="mx-auto grid w-full max-w-2xl gap-4 p-4 sm:p-8">
        <h1 className="text-2xl font-semibold">Tutor not found</h1>
        <div>
          <Link href="/tutors" className={buttonVariants({ variant: "outline" })}>
            Back to tutors
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6 p-4 sm:p-8">
      <div className="grid gap-2">
        <Link href="/tutors" className={buttonVariants({ variant: "ghost", size: "sm", className: "w-fit" })}>
          <ArrowLeft aria-hidden="true" />
          Tutors
        </Link>
        <h1 className="text-2xl font-semibold">{tutor.name || "New tutor"}</h1>
        <p className="text-sm text-muted-foreground">Changes save automatically in this browser.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="tutor-name">Name</Label>
            <Input
              id="tutor-name"
              placeholder="Tutor name"
              value={tutor.name}
              onChange={(event) => updateTutor(tutor.id, { name: event.target.value })}
            />
          </div>
          <ColorSwatches
            label="Color of the tutor's marks"
            colors={TUTOR_COLORS}
            value={tutor.color}
            onChange={(color) => updateTutor(tutor.id, { color })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Voice and language</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto]">
            <FieldSelect
              id="tutor-voice"
              label="Voice"
              value={tutor.voice_id}
              options={VOICE_OPTIONS}
              placeholder="Choose a voice"
              onChange={(voice_id) => updateTutor(tutor.id, { voice_id })}
            />
            <Button type="button" variant="outline" disabled>
              Preview voice
            </Button>
          </div>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <MockBadge /> ElevenLabs voices and previews aren&apos;t connected yet.
          </p>
          <FieldSelect
            id="tutor-language"
            label="Language"
            value={tutor.language}
            options={LANGUAGE_OPTIONS}
            placeholder="Choose a language"
            onChange={(language) => updateTutor(tutor.id, { language })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Teaching</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <FieldSelect
            id="tutor-tone"
            label="Tone"
            value={tutor.tone}
            options={TONE_OPTIONS}
            placeholder="Choose a tone"
            onChange={(tone) => updateTutor(tutor.id, { tone })}
          />
          <FieldSelect
            id="tutor-style"
            label="Teaching style"
            value={tutor.style}
            options={STYLE_OPTIONS}
            placeholder="Choose a teaching style"
            onChange={(style) => updateTutor(tutor.id, { style })}
          />
          <div className="grid gap-2">
            <Label htmlFor="tutor-personality">Personality</Label>
            <Textarea
              id="tutor-personality"
              rows={4}
              placeholder="How should this tutor come across?"
              value={tutor.persona_prompt}
              onChange={(event) => updateTutor(tutor.id, { persona_prompt: event.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rules every tutor follows</CardTitle>
          <CardDescription>These can&apos;t be edited.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {LOCKED_CORE.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {!tutor.is_preset && (
        <div>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              deleteTutor(tutor.id);
              router.push("/tutors");
            }}
          >
            Delete tutor
          </Button>
        </div>
      )}
    </div>
  );
}
