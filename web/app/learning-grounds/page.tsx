import type { Metadata } from "next";
import { LearningGroundsView } from "@/components/learning-grounds-view";

export const metadata: Metadata = { title: "Learning Grounds" };

export default function LearningGroundsPage() {
  return <LearningGroundsView />;
}
