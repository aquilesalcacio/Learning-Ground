import type { Metadata } from "next";
import Link from "next/link";
import { ConversationPanel } from "@/components/conversation-panel";
import { MockBadge } from "@/components/lg-fields";
import { Button, buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Chat" };

export default function ChatPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4 sm:p-8 lg:h-[calc(100dvh-3.5rem)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Chat</h1>
        <Link href="/learning-grounds" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Open this on Learning Grounds
        </Link>
      </div>
      <ConversationPanel
        footer={
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled>
              Add a graph
            </Button>
            <Button type="button" variant="outline" size="sm" disabled>
              Add a doc
            </Button>
            <MockBadge label="Later" />
          </div>
        }
      />
    </div>
  );
}
