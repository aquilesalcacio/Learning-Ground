"use client";

import { Check, ChevronDown, Settings2 } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { getActiveTutor, useLgState } from "@/lib/lg-store";
import { COLOR_HEX, LANGUAGE_OPTIONS, optionLabel, TONE_OPTIONS } from "@/lib/lg-types";

// The pill above the chat bar. Opens to the other tutors, plus a way out to
// the tutors page for editing them.
export function TutorSwitcher({ disabled, onSelect }: { disabled?: boolean; onSelect: (id: string) => void }) {
  const state = useLgState();
  const tutor = getActiveTutor(state);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label={`Tutor: ${tutor.name || "Unnamed tutor"}. Switch tutor`}
            className="rounded-full shadow-sm"
          >
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full"
              style={{ backgroundColor: COLOR_HEX[tutor.color] }}
            />
            {tutor.name || "Unnamed tutor"}
            <ChevronDown aria-hidden="true" />
          </Button>
        }
      />
      <PopoverContent side="top" align="center" className="w-64">
        <div className="grid gap-1">
          <p className="px-1.5 py-1 text-xs text-muted-foreground">Switch tutor</p>
          {state.tutors.map((item) => (
            <PopoverClose
              key={item.id}
              render={
                <Button
                  type="button"
                  variant={item.id === tutor.id ? "secondary" : "ghost"}
                  aria-pressed={item.id === tutor.id}
                  className="h-auto w-full justify-start py-1.5 text-left"
                  onClick={() => onSelect(item.id)}
                >
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: COLOR_HEX[item.color] }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.name || "Unnamed tutor"}</span>
                    <span className="block truncate text-xs font-normal text-muted-foreground">
                      {optionLabel(LANGUAGE_OPTIONS, item.language)} · {optionLabel(TONE_OPTIONS, item.tone)}
                    </span>
                  </span>
                  {item.id === tutor.id && <Check aria-hidden="true" className="shrink-0" />}
                </Button>
              }
            />
          ))}

          <Separator className="my-1" />

          <Link
            href="/tutors"
            className={buttonVariants({ variant: "ghost", className: "w-full justify-start" })}
          >
            <Settings2 aria-hidden="true" />
            Modify tutors
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
