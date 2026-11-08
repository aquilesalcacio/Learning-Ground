"use client";

import { ArrowLeftRight } from "lucide-react";
import Link from "next/link";
import { useCallback } from "react";
import { type OrbMode, TutorOrb } from "@/components/tutor-orb";
import { getActiveConversation, getActiveTutor, type LgState } from "@/lib/lg-store";
import { useLgVoiceLevels } from "@/lib/lg-voice";

const DOCKED_SIZE = "4rem";
// The chat bar's centre: 0.75rem of padding below a 52px bar.
const DOCKED_CENTRE_FROM_BOTTOM = "calc(0.75rem + 26px)";

// The tutor orb. Large in the middle of the start screen with a way to change tutor under it,
// then docked in the bottom-left corner once work starts. --sidebar-overlay (set by the app
// shell) moves it out from under the sidebar on phones, where the sidebar covers the page.
export function TutorStage({ state }: { state: LgState }) {
  const tutor = getActiveTutor(state);
  const conversation = getActiveConversation(state);
  const working = !!state.active_conversation_id;
  const voice = useLgVoiceLevels();
  const { getOutputLevel, getInputLevel } = voice;

  const lastLine = conversation?.messages.at(-1);
  const mode: OrbMode = !voice.live
    ? "idle"
    : voice.speaking
      ? "speaking"
      : lastLine?.who === "student"
        ? "thinking"
        : "listening";

  const levels = useCallback(() => ({ output: getOutputLevel(), input: getInputLevel() }), [getOutputLevel, getInputLevel]);
  const name = tutor.name || "Your tutor";
  const studentName = state.profile.name.trim();

  return (
    <div className="pointer-events-none absolute inset-0 z-10 [--orb-hero:10.5rem] sm:[--orb-hero:14rem]">
      <h1 className="sr-only">{studentName ? `Hi ${studentName}, what are we working on?` : "What are we working on?"}</h1>

      <div
        className="absolute -translate-x-1/2 -translate-y-1/2 transition-[left,top,width,height] duration-700 ease-spring motion-reduce:duration-0"
        style={
          working
            ? {
                left: `calc(var(--sidebar-overlay, 0px) + 0.75rem + ${DOCKED_SIZE} / 2)`,
                // When the sidebar covers the page on a phone, the orb also rises above the chat bar.
                top: `calc(100% - ${DOCKED_CENTRE_FROM_BOTTOM} - min(var(--sidebar-overlay, 0px), 4.5rem))`,
                width: `calc(${DOCKED_SIZE} / 0.6)`,
                height: `calc(${DOCKED_SIZE} / 0.6)`,
              }
            : {
                left: "50%",
                top: "calc(50% - 3rem)",
                width: "calc(var(--orb-hero) / 0.6)",
                height: "calc(var(--orb-hero) / 0.6)",
              }
        }
      >
        <TutorOrb
          color={tutor.color}
          mode={mode}
          levels={levels}
          label={`${name}, your tutor`}
          className="size-full"
        />
      </div>

      {!working && (
        <div
          className="pointer-events-auto absolute left-1/2 grid -translate-x-1/2 justify-items-center gap-2 text-center duration-500 animate-in fade-in-0 slide-in-from-bottom-2"
          style={{ top: "calc(50% - 3rem + var(--orb-hero) / 2 + 1.25rem)" }}
        >
          <p className="text-title">{name}</p>
          <Link
            href="/tutors"
            className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-muted-foreground transition-[transform,color] duration-(--dur-base) ease-spring hover:scale-105 hover:text-foreground active:scale-95"
          >
            <ArrowLeftRight aria-hidden="true" className="size-3" />
            Change tutor
          </Link>
        </div>
      )}
    </div>
  );
}
