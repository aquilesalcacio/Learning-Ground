"use client";

import { useState } from "react";
import { FieldSelect } from "@/components/lg-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { applyLgAction, setLgRegionsVisible } from "@/lib/lg-actions";
import { getActiveDocument, useLgState } from "@/lib/lg-store";
import { Switch } from "@/components/ui/switch";

// The same seam the voice session calls (vision doc, section 8.1), kept as a manual
// test surface. It lives inside the history sidebar so the board stays clear.
export function TutorActions() {
  const regions = getActiveDocument(useLgState())?.regions ?? [];
  const [chosenId, setRegionId] = useState("");
  const [showRegions, setShowRegions] = useState(true);
  const [hint, setHint] = useState("");
  const [latex, setLatex] = useState("");

  // The choice falls back to the first region when the homework changes under it.
  const found = regions.findIndex((item) => item.region_id === chosenId);
  const regionIndex = Math.max(found, 0);
  const region = regions[regionIndex];
  const regionId = region?.region_id ?? "";
  const nextRegion = regions[(regionIndex + 1) % Math.max(regions.length, 1)];
  const regionOptions = regions.map((item) => ({ value: item.region_id, label: `${item.label} (${item.region_id})` }));

  return (
    <details className="px-3 pb-3 text-sm">
      <summary className="cursor-pointer py-2 text-xs text-muted-foreground">Test tutor actions</summary>
      {!region ? (
        <p className="pt-1 text-xs text-muted-foreground">Upload homework to test the tutor&apos;s marks.</p>
      ) : (
        <div className="grid gap-3 pt-1">
          <div className="flex items-center gap-2">
            <Switch
              id="show-regions"
              checked={showRegions}
              onCheckedChange={(checked) => {
                setShowRegions(checked);
                setLgRegionsVisible(checked);
              }}
            />
            <Label htmlFor="show-regions" className="text-xs">
              Show regions on page
            </Label>
          </div>

          <FieldSelect
            id="action-region"
            label="Region"
            value={regionId}
            options={regionOptions}
            placeholder="Choose a region"
            onChange={(next) => {
              setRegionId(next);
              applyLgAction({ type: "focus_region", region_id: next });
            }}
          />

          <div className="flex flex-wrap gap-1">
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
            className="grid gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (!hint.trim()) return;
              applyLgAction({ type: "write_text", near_region_id: regionId, text: hint.trim() });
              setHint("");
            }}
          >
            <Label htmlFor="action-text" className="text-xs">
              Write text near {region.label}
            </Label>
            <div className="flex gap-1">
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
            className="grid gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (!latex.trim()) return;
              applyLgAction({ type: "write_math", near_region_id: regionId, latex: latex.trim() });
              setLatex("");
            }}
          >
            <Label htmlFor="action-math" className="text-xs">
              Write math (raw LaTeX for now)
            </Label>
            <div className="flex gap-1">
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
        </div>
      )}
    </details>
  );
}
