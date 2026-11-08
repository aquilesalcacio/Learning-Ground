"use client";

import {
  ArrowUpRight,
  Eraser,
  Hand,
  Highlighter,
  type LucideIcon,
  MousePointer2,
  Pencil,
  Redo2,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  applyLgAction,
  focusLgPage,
  getLgTool,
  type LgTool,
  redoLg,
  setLgPenColor,
  setLgTool,
  subscribeLgTool,
  undoLg,
} from "@/lib/lg-actions";
import { getActiveDocument, useLgState } from "@/lib/lg-store";
import { COLOR_HEX, PEN_COLORS, type PenColor } from "@/lib/lg-types";

const TOOLS: { tool: LgTool; label: string; icon: LucideIcon }[] = [
  { tool: "draw", label: "Pencil", icon: Pencil },
  { tool: "eraser", label: "Eraser", icon: Eraser },
  { tool: "select", label: "Select", icon: MousePointer2 },
  { tool: "hand", label: "Grabber", icon: Hand },
  { tool: "text", label: "Text", icon: Type },
  { tool: "arrow", label: "Arrow", icon: ArrowUpRight },
  { tool: "laser", label: "Laser pointer", icon: Highlighter },
];

// The pencil button on the left of the chat bar. Everything the board needs lives
// behind it, so the board itself stays free of chrome. There's no background choice:
// the board is always see-through, over the app's dot grid.
export function BoardTools() {
  const document = getActiveDocument(useLgState());
  const tool = useSyncExternalStore(subscribeLgTool, getLgTool, () => "draw" as LgTool);
  const [color, setColor] = useState<PenColor>("black");

  const active = TOOLS.find((item) => item.tool === tool) ?? TOOLS[0];
  const ActiveIcon = active.icon;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Board tools, ${active.label} selected`}
            className="shrink-0 rounded-full"
          >
            <ActiveIcon style={{ color: COLOR_HEX[color] }} />
          </Button>
        }
      />
      <PopoverContent side="top" align="start" className="w-72">
        <div className="grid gap-3">
          <div className="grid grid-cols-4 gap-1" role="group" aria-label="Board tool">
            {TOOLS.map((item) => {
              const Icon = item.icon;
              return (
                <Button
                  key={item.tool}
                  type="button"
                  variant={item.tool === tool ? "secondary" : "ghost"}
                  size="icon"
                  aria-label={item.label}
                  aria-pressed={item.tool === tool}
                  title={item.label}
                  onClick={() => setLgTool(item.tool)}
                >
                  <Icon />
                </Button>
              );
            })}
          </div>

          <Separator />

          <div className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">Color</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Pen color">
              {PEN_COLORS.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-label={item}
                  aria-pressed={item === color}
                  title={item}
                  onClick={() => {
                    setColor(item);
                    setLgPenColor(item);
                  }}
                  className="size-6 rounded-full border-2 border-white shadow-sm transition-transform duration-(--dur-base) ease-spring hover:scale-115 active:scale-90 aria-pressed:scale-110 aria-pressed:ring-2 aria-pressed:ring-foreground/70"
                  style={{ backgroundColor: COLOR_HEX[item] }}
                />
              ))}
            </div>
          </div>

          {document && document.pages.length > 1 && (
            <div className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">Jump to page</span>
              <div className="flex flex-wrap gap-1">
                {document.pages.map((page) => (
                  <Button
                    key={page.number}
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => focusLgPage(page.number)}
                  >
                    {page.number}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <Separator />

          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={undoLg}>
              <Undo2 aria-hidden="true" />
              Undo
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={redoLg}>
              <Redo2 aria-hidden="true" />
              Redo
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => applyLgAction({ type: "clear" })}
            >
              <Trash2 aria-hidden="true" />
              Clear marks
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
