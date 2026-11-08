"use client";

import { type CSSProperties, useEffect, useId, useRef, useSyncExternalStore } from "react";
import { useEditor } from "tldraw";
import { useReducedMotion } from "@/components/tutor-orb";
import { TUTOR_PALETTES } from "@/lib/lg-palette";
import { getActiveTutor, useLgState } from "@/lib/lg-store";
import { getPen, getPenLevel, getPenSnapshot, type PenMode, subscribePen } from "@/lib/lg-tutor-pen";
import { resolveTone } from "@/lib/lg-tutor-prompt";

// The tutor's cursor: a pointer in the tutor's orb colours with a name tag, drawn over the board
// wherever the tutor's pen is (lib/lg-tutor-pen.ts). It has a little character so the student
// can feel someone drawing with them:
// - it leans into its travel and stretches a touch when it moves fast, and floats when idle
// - its eyes blink and look where it's heading, and look up while it reads the student's work
// - it swells with the tutor's voice, trails sparkles while inking, ripples when it taps
// - it hops and bursts into dots when the student gets a problem right
// A humorous tutor wiggles when it arrives, a formal one never does. Reduced motion keeps only
// the position and the name tag.

const SPARKLES = 14;
const BURST = 8;
const SPARKLE_MS = 340;
const BURST_MS = 700;
const RIPPLE_MS = 620;
const HOP_MS = 620;
const WIGGLE_MS = 480;
const DIM_AFTER_MS = 6000;

// The pointer is drawn with its tip at (3, 3) of a 30 × 30 box, and shifted so the tip is the pen.
const TIP = 3;
const EYES = [
  { x: 16.4, y: 12.9 },
  { x: 12.9, y: 16.4 },
];

type Particle = { born: number; x: number; y: number; dx: number; dy: number; color: string };

const approach = (current: number, target: number, rate: number) => current + (target - current) * rate;

export function TutorCursor() {
  const editor = useEditor();
  const tutor = getActiveTutor(useLgState());
  const palette = TUTOR_PALETTES[tutor.color];
  const tone = resolveTone(tutor);
  const name = tutor.name.trim() || "Tutor";
  const pen = useSyncExternalStore(subscribePen, getPenSnapshot, getPenSnapshot);
  const reducedMotion = useReducedMotion();
  // Only letters and digits, so it works inside url(#...).
  const gradientId = `tutor-ink-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const gradient = useRef<SVGLinearGradientElement>(null);
  const eyes = useRef<SVGGElement>(null);
  const happy = useRef<SVGGElement>(null);
  const tag = useRef<HTMLDivElement>(null);
  const dots = useRef<HTMLSpanElement>(null);
  const sparkles = useRef<(HTMLSpanElement | null)[]>([]);
  const burst = useRef<(HTMLSpanElement | null)[]>([]);
  const ripples = useRef<(HTMLSpanElement | null)[]>([]);

  // The draw loop reads the latest of these without restarting.
  const live = useRef({ palette, tone, visible: pen.visible, mode: pen.mode as PenMode, thinking: pen.thinking });
  useEffect(() => {
    live.current = { palette, tone, visible: pen.visible, mode: pen.mode, thinking: pen.thinking };
  }, [palette, tone, pen.visible, pen.mode, pen.thinking]);

  useEffect(() => {
    const cursor = root.current;
    if (!cursor) return;
    let request = 0;
    let last = performance.now();
    let previous: { x: number; y: number } | null = null;
    let vx = 0;
    let vy = 0;
    let opacity = 0;
    let level = 0;
    let angle = 0;
    let lastMode: PenMode = "idle";
    let wiggleAt = -Infinity;
    let blinkAt = performance.now() + 2500;
    let sparkleAt = 0;
    let sparkleIndex = 0;
    let seenTap = getPen().tapAt;
    let seenCelebrate = getPen().celebrateAt;
    let tapAt = -Infinity;
    let tapPoint = { x: 0, y: 0 };
    let burstAt = -Infinity;
    let burstPoint = { x: 0, y: 0 };
    const particles: (Particle | null)[] = Array.from({ length: SPARKLES }, () => null);

    const draw = (now: number) => {
      request = requestAnimationFrame(draw);
      const dt = Math.min(64, Math.max(1, now - last));
      last = now;
      const state = getPen();
      const { palette: colors, tone: style, visible, mode, thinking } = live.current;
      const colorCycle = [colors.c1, colors.c2, colors.c3];

      // Fades in when the pen appears, dims after a while idle, fades out when it hides.
      const idleFor = now - state.activeAt;
      const target = !visible ? 0 : mode === "idle" && !thinking && idleFor > DIM_AFTER_MS ? 0.6 : 1;
      opacity = approach(opacity, target, reducedMotion ? 1 : 0.12);
      cursor.style.opacity = opacity.toFixed(3);
      if (opacity < 0.01 && !visible) {
        previous = null;
        return;
      }

      const screen = editor.pageToViewport({ x: state.x, y: state.y });
      if (previous) {
        vx = approach(vx, (screen.x - previous.x) / dt, 0.25);
        vy = approach(vy, (screen.y - previous.y) / dt, 0.25);
      }
      previous = { x: screen.x, y: screen.y };
      const speed = Math.hypot(vx, vy);

      // A humorous tutor wiggles on arrival.
      if (lastMode === "travel" && mode !== "travel" && style === "humorous") wiggleAt = now;
      lastMode = mode;

      if (state.tapAt !== seenTap) {
        seenTap = state.tapAt;
        tapAt = now;
        tapPoint = { x: state.x, y: state.y };
      }
      if (state.celebrateAt !== seenCelebrate) {
        seenCelebrate = state.celebrateAt;
        burstAt = now;
        burstPoint = { x: state.x, y: state.y };
      }

      level = approach(level, Math.min(1, getPenLevel() * 2.2), 0.25);

      let tilt = 0;
      let stretch = 0;
      let bob = 0;
      let hop = 0;
      let swell = 1;
      if (!reducedMotion) {
        tilt = Math.max(-12, Math.min(12, vx * 16));
        stretch = Math.min(0.1, speed * 0.05);
        if (mode === "idle" && !thinking) bob = Math.sin((now / 3000) * Math.PI * 2) * 2;
        // Looking at work: small, slow sways.
        if (thinking) tilt += Math.sin(now / 260) * 6;
        const wiggle = (now - wiggleAt) / WIGGLE_MS;
        if (wiggle < 1) tilt += Math.sin(wiggle * Math.PI * 5) * 10 * (1 - wiggle);
        const hopping = (now - burstAt) / HOP_MS;
        if (hopping < 1) hop = -Math.sin(hopping * Math.PI) * 14;
        swell = 1 + level * 0.18 + (mode === "point" ? 0.06 : 0);
        angle = (angle + dt * (0.03 + level * 0.12)) % 360;
      }
      cursor.style.transform = `translate3d(${screen.x.toFixed(2)}px, ${(screen.y + bob + hop).toFixed(2)}px, 0)`;
      if (body.current) {
        body.current.style.transform = `rotate(${tilt.toFixed(2)}deg) scale(${(swell * (1 + stretch)).toFixed(3)}, ${(swell * (1 - stretch * 0.6)).toFixed(3)})`;
      }
      gradient.current?.setAttribute("gradientTransform", `rotate(${angle.toFixed(1)} 0.5 0.5)`);
      if (tag.current) {
        tag.current.style.boxShadow = `0 4px 14px -4px rgb(0 0 0 / 0.35), 0 0 0 ${(level * 5).toFixed(2)}px color-mix(in oklch, ${colors.c2} 40%, transparent)`;
      }

      // Eyes: look where it's heading, or up while thinking; blink now and then; smile when happy.
      const celebrating = now - burstAt < BURST_MS + 300;
      if (eyes.current) {
        const lookX = thinking ? -0.6 : Math.max(-0.8, Math.min(0.8, vx * 1.6));
        const lookY = thinking ? -0.8 : Math.max(-0.8, Math.min(0.8, vy * 1.6));
        if (!reducedMotion && now > blinkAt + 120) blinkAt = now + 2200 + Math.random() * 3400;
        const blinking = !reducedMotion && now > blinkAt && now < blinkAt + 120;
        eyes.current.style.opacity = celebrating ? "0" : "1";
        eyes.current.querySelectorAll<SVGElement>("[data-eye]").forEach((eye, index) => {
          const center = EYES[index];
          eye.setAttribute("transform", `translate(${center.x} ${center.y}) scale(1 ${blinking ? 0.12 : 1})`);
        });
        eyes.current.querySelectorAll<SVGElement>("[data-pupil]").forEach((pupil) => {
          pupil.setAttribute("cx", lookX.toFixed(2));
          pupil.setAttribute("cy", lookY.toFixed(2));
        });
      }
      if (happy.current) happy.current.style.opacity = celebrating ? "1" : "0";
      if (dots.current) {
        dots.current.style.display = thinking ? "inline" : "none";
        if (thinking) {
          const phase = Math.floor(now / 380) % 4;
          dots.current.textContent = ".".repeat(phase);
        }
      }

      // Sparkles trail the pen while it inks, in the tutor's colours. They stay on the board.
      if (!reducedMotion && mode === "draw" && now - sparkleAt > 45) {
        sparkleAt = now;
        const zoom = editor.getZoomLevel();
        const spread = 10 / zoom;
        particles[sparkleIndex] = {
          born: now,
          x: state.x,
          y: state.y,
          dx: (Math.random() - 0.5) * spread,
          dy: (Math.random() - 0.3) * spread,
          color: colorCycle[sparkleIndex % 3],
        };
        sparkleIndex = (sparkleIndex + 1) % SPARKLES;
      }
      particles.forEach((particle, index) => {
        const element = sparkles.current[index];
        if (!element) return;
        const age = particle ? (now - particle.born) / SPARKLE_MS : 1;
        if (!particle || age >= 1) {
          element.style.opacity = "0";
          particles[index] = null;
          return;
        }
        const at = editor.pageToViewport({ x: particle.x + particle.dx * age, y: particle.y + particle.dy * age });
        element.style.background = particle.color;
        element.style.opacity = (0.9 * (1 - age)).toFixed(3);
        element.style.transform = `translate3d(${at.x.toFixed(2)}px, ${at.y.toFixed(2)}px, 0) scale(${(1 - age * 0.7).toFixed(3)})`;
      });

      // A tap: two rings spread from the pen tip.
      ripples.current.forEach((ring, index) => {
        if (!ring) return;
        const age = (now - tapAt - index * 140) / RIPPLE_MS;
        if (age < 0 || age >= 1) {
          ring.style.opacity = "0";
          return;
        }
        const at = editor.pageToViewport(tapPoint);
        const grow = reducedMotion ? 1.4 : 0.3 + age * 2.1;
        ring.style.borderColor = colors.c1;
        ring.style.opacity = (0.65 * (1 - age)).toFixed(3);
        ring.style.transform = `translate3d(${at.x.toFixed(2)}px, ${at.y.toFixed(2)}px, 0) scale(${grow.toFixed(3)})`;
      });

      // A celebration: dots burst out from the pen tip.
      burst.current.forEach((dot, index) => {
        if (!dot) return;
        const age = (now - burstAt) / BURST_MS;
        if (reducedMotion || age < 0 || age >= 1) {
          dot.style.opacity = "0";
          return;
        }
        const at = editor.pageToViewport(burstPoint);
        const direction = (index / BURST) * Math.PI * 2 - Math.PI / 2;
        const reach = 30 * (1 - (1 - age) ** 3);
        dot.style.background = colorCycle[index % 3];
        dot.style.opacity = (1 - age).toFixed(3);
        dot.style.transform = `translate3d(${(at.x + Math.cos(direction) * reach).toFixed(2)}px, ${(at.y + Math.sin(direction) * reach).toFixed(2)}px, 0) scale(${(1 - age * 0.5).toFixed(3)})`;
      });
    };
    request = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(request);
  }, [editor, reducedMotion]);

  const particleStyle: CSSProperties = {
    position: "absolute",
    left: -3,
    top: -3,
    width: 6,
    height: 6,
    borderRadius: 9999,
    opacity: 0,
    willChange: "transform, opacity",
  };

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: SPARKLES }, (_, index) => (
        <span key={`s${index}`} ref={(element) => void (sparkles.current[index] = element)} style={particleStyle} />
      ))}
      {Array.from({ length: BURST }, (_, index) => (
        <span key={`b${index}`} ref={(element) => void (burst.current[index] = element)} style={{ ...particleStyle, width: 7, height: 7 }} />
      ))}
      {[0, 1].map((index) => (
        <span
          key={`r${index}`}
          ref={(element) => void (ripples.current[index] = element)}
          style={{
            position: "absolute",
            left: -14,
            top: -14,
            width: 28,
            height: 28,
            borderRadius: 9999,
            border: "2px solid",
            opacity: 0,
            willChange: "transform, opacity",
          }}
        />
      ))}

      <div ref={root} className="absolute left-0 top-0" style={{ opacity: 0, willChange: "transform, opacity" }}>
        <div ref={body} style={{ transformOrigin: "0 0", willChange: "transform" }}>
          <svg
            width="30"
            height="30"
            viewBox="0 0 30 30"
            style={{ position: "absolute", left: -TIP, top: -TIP, overflow: "visible", filter: "drop-shadow(0 2px 3px rgb(0 0 0 / 0.3))" }}
          >
            <defs>
              <linearGradient ref={gradient} id={gradientId} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={palette.c1} />
                <stop offset="55%" stopColor={palette.c2} />
                <stop offset="100%" stopColor={palette.c3} />
              </linearGradient>
            </defs>
            <path
              d="M3 3 L27 12.5 L16.5 15.8 L12.5 27 Z"
              fill={`url(#${gradientId})`}
              stroke="white"
              strokeWidth="2.25"
              strokeLinejoin="round"
            />
            <g ref={eyes}>
              {EYES.map((eye, index) => (
                <g key={index} data-eye="" transform={`translate(${eye.x} ${eye.y})`}>
                  <circle r="2.15" fill="white" />
                  <circle data-pupil="" r="1.1" fill="#1d1d1d" />
                </g>
              ))}
            </g>
            <g ref={happy} style={{ opacity: 0 }} fill="none" stroke="white" strokeWidth="1.3" strokeLinecap="round">
              {EYES.map((eye, index) => (
                <path key={index} d={`M${eye.x - 1.8} ${eye.y + 0.6} Q${eye.x} ${eye.y - 1.9} ${eye.x + 1.8} ${eye.y + 0.6}`} />
              ))}
            </g>
          </svg>
        </div>
        <div
          ref={tag}
          className="absolute left-5 top-6 whitespace-nowrap rounded-full px-2 py-0.5 font-sans text-[11px] font-semibold leading-4 text-white"
          style={{ background: palette.accent, border: "1.5px solid rgb(255 255 255 / 0.85)" }}
        >
          {pen.thinking ? `${name} is looking` : name}
          <span ref={dots} style={{ display: "none" }} />
        </div>
      </div>
    </div>
  );
}
