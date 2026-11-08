"use client";

import { cn } from "cn";
import { useEffect, useRef } from "react";

// The app's background: a faint wash of the tutor's colours, the dot grid, and a second
// layer of brighter dots that only shows near the pointer, like a light passing over.
// Pointer tracking writes CSS variables directly, so moving the mouse never re-renders React.
export function DotField({ className }: { className?: string }) {
  const field = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = field.current;
    if (!element) return;
    let frame = 0;
    let x = 0;
    let y = 0;

    function paint() {
      frame = 0;
      if (!element) return;
      const bounds = element.getBoundingClientRect();
      const inside = x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
      element.style.setProperty("--px", `${x - bounds.left}px`);
      element.style.setProperty("--py", `${y - bounds.top}px`);
      element.style.setProperty("--glow", inside ? "1" : "0");
    }

    function move(event: PointerEvent) {
      // A finger has no hover, and a glow left behind under it would look like a smudge.
      if (event.pointerType === "touch") return;
      x = event.clientX;
      y = event.clientY;
      if (!frame) frame = requestAnimationFrame(paint);
    }

    function leave() {
      element?.style.setProperty("--glow", "0");
    }

    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, []);

  return (
    <div ref={field} aria-hidden="true" className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div className="tutor-tint absolute inset-0" />
      <div className="dot-grid absolute inset-0" />
      <div className="dot-grid-glow absolute inset-0" />
    </div>
  );
}
