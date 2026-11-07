import type { Metadata } from "next";
import { TutorsView } from "@/components/tutors-view";

export const metadata: Metadata = { title: "Tutors" };

export default function TutorsPage() {
  return <TutorsView />;
}
