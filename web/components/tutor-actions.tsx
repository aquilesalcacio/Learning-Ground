"use client";

import { type FormEvent, useState } from "react";
import { FieldSelect } from "@/components/lg-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { applyLgAction, askLgQuestion, type LgAction } from "@/lib/lg-actions";
import { parseNumber, parseNumberLineMarks } from "@/lib/lg-ink";
import { getActiveDocument, getBoardQuestions, useLgState } from "@/lib/lg-store";

// Asks a question on the board, as the tutor's ask_question tool does, beside a region or on a
// free spot. Works with no homework open, which is how the tutor teaches on a blank board.
function AskForm({ regionId, regionLabel }: { regionId: string; regionLabel: string }) {
  const [question, setQuestion] = useState("");
  const [outcome, setOutcome] = useState("");
  function ask(event: FormEvent, near: string) {
    event.preventDefault();
    if (!question.trim()) return;
    const result = askLgQuestion(question, near);
    setOutcome(result.ok ? `Wrote ${result.id}` : result.message);
    if (result.ok) setQuestion("");
  }
  return (
    <form className="grid gap-1.5" onSubmit={(event) => ask(event, regionId)}>
      <Label htmlFor="action-ask" className="text-xs">
        Ask a question on the board
      </Label>
      <Input
        id="action-ask"
        placeholder="What is 3/4 + 1/8?"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-1">
        {regionId && (
          <Button type="submit" variant="outline" size="sm">
            Beside {regionLabel}
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={(event) => ask(event, "")}>
          On a free spot
        </Button>
        {outcome && <span className="text-xs text-muted-foreground">{outcome}</span>}
      </div>
    </form>
  );
}

// The same seam the voice session calls (vision doc, section 8.1), kept as a manual
// test surface for every tutor tool. It lives inside the history sidebar so the board stays clear.
export function TutorActions() {
  const state = useLgState();
  const homework = getActiveDocument(state)?.regions ?? [];
  // Questions the tutor wrote count as targets too, so their marks can be tested on a blank board.
  const questions = getBoardQuestions(state).map((question) => ({
    region_id: question.id,
    label: `Question ${question.id.slice(1)}`,
  }));
  const regions = [...homework, ...questions];
  const [chosenId, setRegionId] = useState("");
  const [hint, setHint] = useState("");
  const [latex, setLatex] = useState("");
  const [range, setRange] = useState("0, 1");
  const [marks, setMarks] = useState("0.5:1/2");

  // The choice falls back to the first region when the homework changes under it.
  const found = regions.findIndex((item) => item.region_id === chosenId);
  const regionIndex = Math.max(found, 0);
  const region = regions[regionIndex];
  const regionId = region?.region_id ?? "";
  const nextRegion = regions[(regionIndex + 1) % Math.max(regions.length, 1)];
  const regionOptions = regions.map((item) => ({ value: item.region_id, label: `${item.label} (${item.region_id})` }));

  const marksButtons: { label: string; action: LgAction }[] = region
    ? [
        { label: "Focus", action: { type: "focus_region", region_id: regionId } },
        { label: "Point", action: { type: "point_at", region_id: regionId } },
        { label: "Circle", action: { type: "circle_region", region_id: regionId } },
        { label: "Underline", action: { type: "underline_region", region_id: regionId } },
        { label: "Highlight", action: { type: "highlight_region", region_id: regionId } },
        {
          label: `Arrow to ${nextRegion.label}`,
          action: { type: "draw_arrow", from_region_id: regionId, to_region_id: nextRegion.region_id, label: "same idea" },
        },
        { label: "Clear", action: { type: "clear" } },
      ]
    : [];

  function writeNumberLine(event: FormEvent) {
    event.preventDefault();
    const [min, max] = range.split(",").map((part) => parseNumber(part));
    applyLgAction({ type: "number_line", near_region_id: regionId, min, max, marks: parseNumberLineMarks(marks) });
  }

  return (
    <details className="px-3 pb-3 text-sm">
      <summary className="cursor-pointer py-2 text-xs text-muted-foreground">Test tutor actions</summary>
      {!region ? (
        <div className="grid gap-3 pt-1">
          <p className="text-xs text-muted-foreground">
            Upload homework, or ask a question on the board, to test the tutor&apos;s marks.
          </p>
          <AskForm regionId="" regionLabel="" />
        </div>
      ) : (
        <div className="grid gap-3 pt-1">
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
            {marksButtons.map(({ label, action }) => (
              <Button key={label} type="button" variant="outline" size="sm" onClick={() => applyLgAction(action)}>
                {label}
              </Button>
            ))}
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
              Write math (LaTeX)
            </Label>
            <div className="flex gap-1">
              <Input
                id="action-math"
                placeholder="\frac{3}{4} + x"
                value={latex}
                onChange={(event) => setLatex(event.target.value)}
              />
              <Button type="submit" variant="outline" size="sm">
                Write
              </Button>
            </div>
          </form>

          <AskForm regionId={regionId} regionLabel={region.label} />

          <form className="grid gap-1.5" onSubmit={writeNumberLine}>
            <Label htmlFor="action-range" className="text-xs">
              Number line: min, max, then marks as value:label
            </Label>
            <div className="flex gap-1">
              <Input id="action-range" className="w-20" value={range} onChange={(event) => setRange(event.target.value)} />
              <Input
                aria-label="Marks"
                placeholder="0.5:1/2, 0.75"
                value={marks}
                onChange={(event) => setMarks(event.target.value)}
              />
              <Button type="submit" variant="outline" size="sm">
                Draw
              </Button>
            </div>
          </form>
        </div>
      )}
    </details>
  );
}
