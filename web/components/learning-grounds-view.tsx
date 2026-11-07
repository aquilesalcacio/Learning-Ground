"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { ConversationPanel } from "@/components/conversation-panel";
import { ColorSwatches, FieldSelect, MockBadge } from "@/components/lg-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  applyLgAction,
  focusLgPage,
  setLgBackground,
  setLgPenColor,
  setLgRegionsVisible,
} from "@/lib/lg-actions";
import { LG_PAGES, LG_REGIONS } from "@/lib/lg-regions";
import { useHydrated, useLgState } from "@/lib/lg-store";
import { BACKGROUND_OPTIONS, type LgBackground, PEN_COLORS, type PenColor } from "@/lib/lg-types";

const LgBoard = dynamic(() => import("@/components/lg-board"), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-muted-foreground">Loading board...</p>,
});

export function LearningGroundsView() {
  const state = useLgState();
  const hydrated = useHydrated();
  const [regionId, setRegionId] = useState(LG_REGIONS[0].region_id);
  const [showRegions, setShowRegions] = useState(true);
  const [background, setBackground] = useState<LgBackground>("plain");
  const [penColor, setPenColor] = useState<PenColor>("black");
  const [hint, setHint] = useState("");
  const [latex, setLatex] = useState("");

  const regionIndex = LG_REGIONS.findIndex((item) => item.region_id === regionId);
  const region = LG_REGIONS[regionIndex];
  const nextRegion = LG_REGIONS[(regionIndex + 1) % LG_REGIONS.length];

  function selectRegion(id: string) {
    setRegionId(id);
    applyLgAction({ type: "focus_region", region_id: id });
  }

  return (
    <div className="flex flex-1 flex-col lg:h-[calc(100dvh-3.5rem)] lg:flex-row">
      <aside
        aria-label="Homework and board settings"
        className="flex flex-col gap-5 border-b p-4 lg:w-64 lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-b-0"
      >
        <section className="grid gap-2">
          <h2 className="font-medium">Homework</h2>
          <p className="text-sm break-words text-muted-foreground">
            {state.document?.filename ?? "No PDF uploaded. Add one on Start."}
          </p>
          <div className="flex flex-wrap gap-2">
            {LG_PAGES.map((page) => (
              <Button
                key={page.number}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => focusLgPage(page.number)}
              >
                Page {page.number}
              </Button>
            ))}
          </div>
        </section>

        <section className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">Regions</h2>
            <MockBadge />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="show-regions"
              checked={showRegions}
              onCheckedChange={(checked) => {
                setShowRegions(checked);
                setLgRegionsVisible(checked);
              }}
            />
            <Label htmlFor="show-regions">Show on page</Label>
          </div>
          <ul className="grid gap-1">
            {LG_REGIONS.map((item) => (
              <li key={item.region_id}>
                <Button
                  type="button"
                  variant={item.region_id === regionId ? "secondary" : "ghost"}
                  size="sm"
                  aria-pressed={item.region_id === regionId}
                  className="w-full justify-between"
                  onClick={() => selectRegion(item.region_id)}
                >
                  {item.label}
                  <span className="font-mono text-xs text-muted-foreground">{item.region_id}</span>
                </Button>
              </li>
            ))}
          </ul>
        </section>

        <section className="grid gap-3">
          <h2 className="font-medium">Board</h2>
          <FieldSelect
            id="board-background"
            label="Background"
            value={background}
            options={BACKGROUND_OPTIONS}
            placeholder="Choose a background"
            onChange={(next) => {
              setBackground(next);
              setLgBackground(next);
            }}
          />
          <ColorSwatches
            label="Pen color"
            colors={PEN_COLORS}
            value={penColor}
            onChange={(next) => {
              setPenColor(next);
              setLgPenColor(next);
            }}
          />
        </section>
      </aside>

      <div className="relative h-[70dvh] min-w-0 flex-1 lg:h-auto">
        {hydrated && <LgBoard filename={state.document?.filename ?? null} />}
      </div>

      <aside
        aria-label="Tutor"
        className="flex flex-col gap-4 border-t p-4 lg:w-80 lg:shrink-0 lg:overflow-y-auto lg:border-t-0 lg:border-l"
      >
        <ConversationPanel
          checkWorkTarget={region.label}
          footer={
            <details className="rounded-md border p-3 text-sm">
              <summary className="cursor-pointer font-medium">Test tutor actions</summary>
              <div className="mt-3 grid gap-3">
                <p className="text-xs text-muted-foreground">
                  These draw for real on the board, on {region.label}. Voice will call the same actions.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => applyLgAction({ type: "focus_region", region_id: regionId })}
                  >
                    Focus
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => applyLgAction({ type: "circle_region", region_id: regionId })}
                  >
                    Circle
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      applyLgAction({
                        type: "draw_arrow",
                        from_region_id: regionId,
                        to_region_id: nextRegion.region_id,
                      })
                    }
                  >
                    Arrow to {nextRegion.label}
                  </Button>
                </div>

                <form
                  className="grid gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!hint.trim()) return;
                    applyLgAction({ type: "write_text", near_region_id: regionId, text: hint.trim() });
                    setHint("");
                  }}
                >
                  <Label htmlFor="action-text">Write text</Label>
                  <div className="flex gap-2">
                    <Input
                      id="action-text"
                      placeholder="A hint for the margin"
                      value={hint}
                      onChange={(event) => setHint(event.target.value)}
                    />
                    <Button type="submit" variant="outline" size="sm">
                      Write
                    </Button>
                  </div>
                </form>

                <form
                  className="grid gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!latex.trim()) return;
                    applyLgAction({ type: "write_math", near_region_id: regionId, latex: latex.trim() });
                    setLatex("");
                  }}
                >
                  <Label htmlFor="action-math">Write math (raw LaTeX for now)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="action-math"
                      placeholder="LaTeX"
                      value={latex}
                      onChange={(event) => setLatex(event.target.value)}
                    />
                    <Button type="submit" variant="outline" size="sm">
                      Write
                    </Button>
                  </div>
                </form>

                <Button type="button" variant="outline" size="sm" onClick={() => applyLgAction({ type: "clear" })}>
                  Clear tutor marks
                </Button>
              </div>
            </details>
          }
        />
      </aside>
    </div>
  );
}
