import type { Metadata } from "next";
import { CanvasLmsLaunchView } from "@/components/canvas-lms-launch";

export const metadata: Metadata = { title: "Opening from Canvas LMS" };

export default function CanvasLmsLaunchPage() {
  return <CanvasLmsLaunchView />;
}
