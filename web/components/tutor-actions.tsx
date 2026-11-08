"use client";

import { type FormEvent, useState } from "react";
import { FieldSelect } from "@/components/lg-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { applyLgAction, askLgQuestion, type LgAction } from "@/lib/lg-actions";
import { parseNumber, parseNumberLineMarks, SHAPE_KINDS, type ShapeKind } from "@/lib/lg-ink";
import { runStudentProgress } from "@/lib/lg-progress-run";
import { getActiveDocument, getBoardQuestions, getBoardSelections, useLgState } from "@/lib/lg-store";

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

const SHAPE_NAMES: Record<ShapeKind, string> = {
  rectangle: "Rectangle",
  square: "Square",
  triangle: "Triangle",
  right_triangle: "Right triangle",
  circle: "Circle",
  fraction_bar: "Fraction bar",
  fraction_circle: "Fraction circle",
};

// Used when the labels box is left empty, so each shape shows what its labels do.
const SAMPLE_LABELS: Record<ShapeKind, string> = {
  rectangle: "8 cm, 3 cm",
  square: "s=4",
  triangle: "b=6, h=4",
  right_triangle: "a=3, b=4, c=?",
  circle: "r=5",
  fraction_bar: "",
  fraction_circle: "",
};

// plot_graph and draw_shape, beside the chosen region or question, or on a free spot when
// there's none or the switch says so.
function FigureForms({ near }: { near: string }) {
  const [functions, setFunctions] = useState("2x+1; x^2-3");
  const [xRange, setXRange] = useState("-5, 5");
  const [yRange, setYRange] = useState("");
  const [points, setPoints] = useState("0,1:intercept");
  const [labels, setLabels] = useState("");
  const [fraction, setFraction] = useState("4, 3");
  const [freeSpot, setFreeSpot] = useState(false);
  const near_region_id = near && !freeSpot ? near : undefined;

  function plot(event: FormEvent) {
    event.preventDefault();
    const [x_min, x_max] = xRange.split(",").map((part) => parseNumber(part));
    const [y_min, y_max] = yRange.trim() ? yRange.split(",").map((part) => parseNumber(part)) : [];
    const marked = points.trim() || undefined;
    applyLgAction({ type: "plot_graph", near_region_id, functions, x_min, x_max, y_min, y_max, points: marked });
  }

  function draw(shape: ShapeKind) {
    const [parts, shaded] = fraction.split(",").map((part) => parseNumber(part));
    applyLgAction({ type: "draw_shape", near_region_id, shape, labels: labels.trim() || SAMPLE_LABELS[shape], parts, shaded });
  }

  return (
    <>
      {near && (
        <div className="flex items-center gap-2">
          <Switch id="action-figure-free" size="sm" checked={freeSpot} onCheckedChange={setFreeSpot} />
          <Label htmlFor="action-figure-free" className="text-xs">
            Graphs and shapes on a free spot
          </Label>
        </div>
      )}
      <form className="grid gap-1.5" onSubmit={plot}>
        <Label htmlFor="action-functions" className="text-xs">
          Graph: functions, x range, optional y range and points
        </Label>
        <Input id="action-functions" value={functions} onChange={(event) => setFunctions(event.target.value)} />
        <div className="flex gap-1">
          <Input aria-label="x range" className="w-20" value={xRange} onChange={(event) => setXRange(event.target.value)} />
          <Input
            aria-label="y range"
            className="w-20"
            placeholder="auto"
            value={yRange}
            onChange={(event) => setYRange(event.target.value)}
          />
          <Input aria-label="Points" placeholder="2,5:vertex" value={points} onChange={(event) => setPoints(event.target.value)} />
          <Button type="submit" variant="outline" size="sm">
            Plot
          </Button>
        </div>
      </form>

      <div className="grid gap-1.5">
        <Label htmlFor="action-labels" className="text-xs">
          Shape: labels, and parts, shaded for fractions
        </Label>
        <div className="flex gap-1">
          <Input
            id="action-labels"
            placeholder="Each shape's sample"
            value={labels}
            onChange={(event) => setLabels(event.target.value)}
          />
          <Input
            aria-label="Parts, shaded"
            className="w-20"
            value={fraction}
            onChange={(event) => setFraction(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {SHAPE_KINDS.map((shape) => (
            <Button key={shape} type="button" variant="outline" size="sm" onClick={() => draw(shape)}>
              {SHAPE_NAMES[shape]}
            </Button>
          ))}
        </div>
      </div>
    </>
  );
}

// Runs get_student_progress as the tutor would, pen and all, and shows the report it would get.
function ProgressButton() {
  const [report, setReport] = useState("");
  const [running, setRunning] = useState(false);
  async function lookUp() {
    setRunning(true);
    setReport(await runStudentProgress());
    setRunning(false);
  }
  return (
    <div className="grid gap-1.5">
      <div>
        <Button type="button" variant="outline" size="sm" disabled={running} onClick={lookUp}>
          {running ? "Looking up progress..." : "Look up progress"}
        </Button>
      </div>
      {report && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">{report}</pre>
      )}
    </div>
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
  // So do spots the student circled with Show the tutor, aimed at by their s IDs.
  const selections = getBoardSelections(state).map((selection) => ({
    region_id: selection.id,
    label: `Circled spot ${selection.id.slice(1)}`,
  }));
  const regions = [...homework, ...questions, ...selections];
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
            Upload homework, ask a question on the board, or circle something with Show the tutor, to test the
            tutor&apos;s marks.
          </p>
          <AskForm regionId="" regionLabel="" />
          <ProgressButton />
          <FigureForms near="" />
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
          <ProgressButton />

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

          <FigureForms near={regionId} />
        </div>
      )}
    </details>
  );
}
