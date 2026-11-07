import type { Metadata } from "next";
import { ProfileView } from "@/components/profile-view";

export const metadata: Metadata = { title: "Student Profile" };

export default function ProfilePage() {
  return <ProfileView />;
}
