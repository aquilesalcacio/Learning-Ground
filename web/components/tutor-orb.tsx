"use client";

import { cn } from "cn";
import { type CSSProperties, useEffect, useRef, useSyncExternalStore } from "react";
import { paletteVars } from "@/lib/lg-palette";
import type { TutorColor } from "@/lib/lg-types";

// What the tutor is doing. The orb shows it.
export type OrbMode = "idle" | "listening" | "thinking" | "speaking";
export type OrbLevels = () => { output: number; input: number };

// Anything can make the orb give a small bounce, such as the student typing.
const pulseListeners = new Set<(strength: number) => void>();
export function pulseTutorOrb(strength = 0.35) {
  pulseListeners.forEach((listener) => listener(strength));
}

// How fast the colours turn, in degrees a second, for each mode.
const TURN_SPEED: Record<OrbMode, number> = {
  idle: 18,
  listening: 26,
  thinking: 70,
  speaking: 34,
};

function subscribeReducedMotion(listener: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

const approach = (current: number, target: number, rate: number) => current + (target - current) * rate;

// A round orb of turning colour in the tutor's palette, styled in globals.css (.tutor-orb).
// It turns faster while thinking, swells with the tutor's voice and the student's, and glows
// while speaking. With reduced motion it holds still and only the glow shows that it's speaking.
export function TutorOrb({
  color,
  mode,
  levels,
  label,
  className,
}: {
  color: TutorColor;
  mode: OrbMode;
  levels?: OrbLevels;
  label: string;
  className?: string;
}) {
  const frame = useRef<HTMLSpanElement>(null);
  const reducedMotion = useReducedMotion();
  // The draw loop reads the latest props from here, so a change of mode never restarts it.
  const live = useRef({ mode, levels });
  const pulse = useRef(0);

  useEffect(() => {
    live.current = { mode, levels };
  }, [mode, levels]);

  useEffect(() => {
    const listener = (strength: number) => {
      pulse.current = Math.min(1, pulse.current + strength);
    };
    pulseListeners.add(listener);
    return () => {
      pulseListeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    const host = frame.current;
    if (!host || reducedMotion) return;

    // How close the pointer is, so the orb brightens a little as it comes near.
    let hoverTarget = 0;
    const onPointer = (event: PointerEvent) => {
      const bounds = host.getBoundingClientRect();
      const radius = bounds.width / 2;
      const distance = Math.hypot(
        event.clientX - (bounds.left + radius),
        event.clientY - (bounds.top + bounds.height / 2),
      );
      hoverTarget = Math.min(Math.max(1 - (distance - radius) / (radius * 2), 0), 1);
    };
    const onLeave = () => {
      hoverTarget = 0;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);

    let request = 0;
    let last = performance.now();
    let angle = 0;
    let speed = TURN_SPEED[live.current.mode];
    let level = 0;
    let listen = 0;
    let hover = 0;
    const draw = (now: number) => {
      request = requestAnimationFrame(draw);
      const seconds = Math.min((now - last) / 1000, 0.1);
      last = now;
      const state = live.current;
      const voice = state.levels?.() ?? { output: 0, input: 0 };

      level = approach(level, state.mode === "speaking" ? Math.min(voice.output * 2.4, 1) : 0, 0.2);
      listen = approach(listen, state.mode === "listening" ? Math.min(voice.input * 2, 1) : 0, 0.2);
      hover = approach(hover, hoverTarget, 0.1);
      speed = approach(speed, TURN_SPEED[state.mode] + level * 60, 0.04);
      angle = (angle + speed * seconds) % 360;
      pulse.current *= 0.92;

      const breathe = 0.012 * Math.sin(now * 0.0013);
      const scale = 1 + breathe + level * 0.07 + listen * 0.04 + pulse.current * 0.06 + hover * 0.02;
      const glow = Math.min(1, level * 0.9 + (state.mode === "speaking" ? 0.25 : 0) + listen * 0.3 + hover * 0.2 + pulse.current * 0.4);
      host.style.setProperty("--orb-angle", `${angle.toFixed(2)}deg`);
      host.style.setProperty("--orb-scale", scale.toFixed(4));
      host.style.setProperty("--orb-glow", glow.toFixed(3));
    };
    request = requestAnimationFrame(draw);

    // Also runs when Next hides this page, so a hidden page never keeps drawing.
    return () => {
      cancelAnimationFrame(request);
      window.removeEventListener("pointermove", onPointer);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      host.style.removeProperty("--orb-angle");
      host.style.removeProperty("--orb-scale");
      host.style.removeProperty("--orb-glow");
    };
  }, [reducedMotion]);

  const style = {
    ...paletteVars(color),
    ...(reducedMotion ? { "--orb-glow": mode === "speaking" ? 0.6 : 0 } : {}),
  } as CSSProperties;

  // The box is larger than the orb, to leave room for its glow and swell. Only the orb itself
  // (the middle 60%) takes clicks, so the glow never blocks drawing on the board.
  return (
    <span className={cn("pointer-events-none relative block", className)}>
      <span ref={frame} aria-hidden="true" className="tutor-theme tutor-orb-frame absolute inset-[20%]" style={style}>
        <span className="tutor-orb-halo" />
        <span className="tutor-orb" />
      </span>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => pulseTutorOrb(0.9)}
        className="pointer-events-auto absolute inset-[20%] cursor-pointer rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
    </span>
  );
}
