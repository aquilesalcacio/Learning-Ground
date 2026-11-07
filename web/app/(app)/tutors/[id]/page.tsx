import type { Metadata } from "next";
import { Suspense } from "react";
import { TutorEditor } from "@/components/tutor-editor";

export const metadata: Metadata = { title: "Edit tutor" };

export default function TutorEditorPage() {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-muted-foreground">Loading tutor...</p>}>
      <TutorEditor />
    </Suspense>
  );
}
