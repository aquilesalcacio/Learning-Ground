"use client";

import { FileText, Trash2 } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import {
  endLgFileMove,
  getLgFiles,
  getLgSelectedFile,
  getLgTool,
  getNoLgFiles,
  type LgBoardFile,
  type LgTool,
  moveLgFileBy,
  removeLgFile,
  selectLgFile,
  startLgFileMove,
  subscribeLgFiles,
  subscribeLgTool,
} from "@/lib/lg-actions";

const DRAG_THRESHOLD = 3;
const OUTLINE = 6;

const noSelection = () => null;
const drawTool = () => "draw" as LgTool;

// Handles sit over the files, so the wheel lands on them. Passing it on keeps zoom and scroll
// working with the pointer over a file.
function passWheelToBoard(event: ReactWheelEvent<HTMLElement>) {
  document.querySelector(".tl-canvas")?.dispatchEvent(new WheelEvent("wheel", event.nativeEvent));
}

function FileHandle({ file, mode, selected }: { file: LgBoardFile; mode: "grab" | "select"; selected: boolean }) {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; started: boolean } | null>(null);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, started: false };
    if (mode === "select") selectLgFile(file.id);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.started) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      current.started = true;
      startLgFileMove(file.id);
      setDragging(true);
    }
    moveLgFileBy(dx, dy);
    current.x = event.clientX;
    current.y = event.clientY;
  }

  function onPointerUp() {
    const current = drag.current;
    drag.current = null;
    if (!current?.started) return;
    endLgFileMove();
    setDragging(false);
  }

  return (
    <div
      aria-label={mode === "grab" ? `Move ${file.filename}` : `${file.filename}, selected`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={passWheelToBoard}
      className={`group pointer-events-auto absolute touch-none rounded-xl transition-[box-shadow,background-color] duration-(--dur-base) ease-soft ${
        dragging ? "cursor-grabbing" : "cursor-grab"
      } ${
        dragging
          ? "bg-tutor-accent/5 shadow-lift ring-2 ring-tutor-accent"
          : selected
            ? "ring-2 ring-tutor-accent shadow-[0_0_0_6px_color-mix(in_oklch,var(--tutor-accent)_14%,transparent)]"
            : "hover:bg-tutor-accent/5 hover:ring-2 hover:ring-tutor-accent/45"
      }`}
      style={{ left: file.x - OUTLINE, top: file.y - OUTLINE, width: file.w + OUTLINE * 2, height: file.h + OUTLINE * 2 }}
    />
  );
}

const TOOLBAR_SPACE = 52;

function subscribeResize(listener: () => void) {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
}

function FileToolbar({ file }: { file: LgBoardFile }) {
  const viewHeight = useSyncExternalStore(subscribeResize, () => window.innerHeight, () => 800);
  // Above the file when there's room, else below it, so it never covers the page's own text.
  // A file filling the whole screen gets it pinned at the top.
  const top =
    file.y >= TOOLBAR_SPACE + 8
      ? file.y - TOOLBAR_SPACE
      : file.y + file.h + TOOLBAR_SPACE + 96 < viewHeight
        ? file.y + file.h + 12
        : 8;
  return (
    <div
      className="glass pointer-events-auto absolute flex max-w-[min(22rem,calc(100%-1rem))] items-center gap-2 rounded-full bg-white/80 py-1 pr-1 pl-3 text-sm duration-200 animate-in fade-in-0 zoom-in-95"
      style={{ left: Math.max(8, file.x), top }}
    >
      <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate font-medium">{file.filename}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {file.pageCount} {file.pageCount === 1 ? "page" : "pages"}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="shrink-0 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => removeLgFile(file.id)}
      >
        <Trash2 aria-hidden="true" />
        Remove
      </Button>
    </div>
  );
}

// Lets the student handle the homework files on the board. With the grabber, any file can be
// dragged (empty board still pans). With the select tool, a clicked file is outlined, can be
// dragged, and shows its name with a Remove button; Delete removes it too, Escape lets it go.
// With drawing tools nothing is here, so writing on the pages works as before.
export function BoardFiles() {
  const files = useSyncExternalStore(subscribeLgFiles, getLgFiles, getNoLgFiles);
  const selected = useSyncExternalStore(subscribeLgFiles, getLgSelectedFile, noSelection);
  const tool = useSyncExternalStore(subscribeLgTool, getLgTool, drawTool);
  const grab = tool === "hand";
  const selectedFile = tool === "select" ? files.find((file) => file.id === selected) : undefined;

  useEffect(() => {
    if (!selectedFile) return;
    const id = selectedFile.id;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeLgFile(id);
      } else if (event.key === "Escape") {
        selectLgFile(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedFile]);

  if (!files.length) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
      {files.map((file) =>
        grab || file.id === selectedFile?.id ? (
          <FileHandle key={file.id} file={file} mode={grab ? "grab" : "select"} selected={file.id === selectedFile?.id} />
        ) : null,
      )}
      {selectedFile && <FileToolbar file={selectedFile} />}
    </div>
  );
}
