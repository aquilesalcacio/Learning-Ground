"use client";

import { cn } from "cn";
import { Mesh, Program, Renderer, Triangle } from "ogl";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { type LinearRgb, paletteRgb, TUTOR_PALETTES } from "@/lib/lg-palette";
import type { TutorColor } from "@/lib/lg-types";

// What the tutor is doing. The orb shows it.
export type OrbMode = "idle" | "listening" | "thinking" | "speaking";
export type OrbLevels = () => { output: number; input: number };

// Anything can make the orb give a small bounce, such as the student typing. Adapted from
// the 21st.dev voice-powered orb (docs/design/21st/), driven by the tutor's voice instead of its own microphone.
const pulseListeners = new Set<(strength: number) => void>();
export function pulseTutorOrb(strength = 0.35) {
  pulseListeners.forEach((listener) => listener(strength));
}

const VERTEX = /* glsl */ `
  attribute vec2 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec3 uC1;
  uniform vec3 uC2;
  uniform vec3 uC3;
  uniform float uLevel;
  uniform float uListen;
  uniform float uHover;
  uniform vec2 uPointer;
  uniform float uPulse;
  uniform float uSwirl;
  varying vec2 vUv;

  vec3 hash33(vec3 p3) {
    p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
    p3 += dot(p3, p3.yxz + 19.19);
    return -1.0 + 2.0 * fract(vec3(p3.x + p3.y, p3.x + p3.z, p3.y + p3.z) * p3.zyx);
  }

  float snoise3(vec3 p) {
    const float K1 = 0.333333333;
    const float K2 = 0.166666667;
    vec3 i = floor(p + (p.x + p.y + p.z) * K1);
    vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
    vec3 e = step(vec3(0.0), d0 - d0.yzx);
    vec3 i1 = e * (1.0 - e.zxy);
    vec3 i2 = 1.0 - e.zxy * (1.0 - e);
    vec3 d1 = d0 - (i1 - K2);
    vec3 d2 = d0 - (i2 - K1);
    vec3 d3 = d0 - 0.5;
    vec4 h = max(0.6 - vec4(dot(d0, d0), dot(d1, d1), dot(d2, d2), dot(d3, d3)), 0.0);
    vec4 n = h * h * h * h * vec4(dot(d0, hash33(i)), dot(d1, hash33(i + i1)), dot(d2, hash33(i + i2)), dot(d3, hash33(i + 1.0)));
    return dot(vec4(31.316), n);
  }

  void main() {
    vec2 uv = (vUv - 0.5) * 2.0;
    float len = length(uv);
    vec2 dir = len > 0.0001 ? uv / len : vec2(0.0);
    float t = uTime * (0.3 + uSwirl * 0.9 + uLevel * 0.7);

    // The edge wobbles with noise. Speaking, listening and bounces make it wobble more.
    float amp = 0.03 + uLevel * 0.11 + uListen * 0.05 + uPulse * 0.07;
    float edge = snoise3(vec3(dir * 1.2, t * 0.8)) + 0.5 * snoise3(vec3(dir * 2.5 + 7.0, t * 1.5));
    float r = 0.6 * (1.0 + edge * amp);
    r *= 1.0 + 0.018 * sin(uTime * 1.25) + uLevel * 0.05 + uPulse * 0.04;
    // It leans toward the pointer.
    r += uHover * 0.07 * max(0.0, dot(dir, uPointer));

    float px = 2.0 / min(uResolution.x, uResolution.y);
    float body = smoothstep(r + px * 1.5, r - px * 1.5, len);

    // Colours flow inside, in the tutor's palette.
    vec2 p = uv / max(r, 0.001);
    float f1 = snoise3(vec3(p * 0.85, t * 0.45));
    float f2 = snoise3(vec3(p * 1.1 + vec2(3.1, -1.7), t * 0.55 + 10.0));
    vec3 col = mix(uC1, uC2, smoothstep(-0.45, 0.55, f1));
    col = mix(col, uC3, smoothstep(-0.25, 0.7, f2) * 0.85);

    // Soft 3D: lit from the top left, a bright rim, and a glossy highlight.
    float light = dot(p, normalize(vec2(-0.6, 0.75)));
    col *= 0.9 + 0.16 * light;
    float rim = smoothstep(0.6, 1.0, len / r);
    col = mix(col, min(col * 1.3 + 0.06, vec3(1.0)), rim * 0.45);
    float spec = smoothstep(0.42, 0.0, length(p - vec2(-0.3, 0.36)));
    col += spec * 0.3;
    col *= 1.0 + uLevel * 0.22 + uHover * 0.06;

    // A soft halo in the tutor's colours, stronger while speaking, rippling with the voice.
    float outside = max(len - r, 0.0);
    float halo = exp(-outside * 8.0) * (0.22 + uLevel * 0.5 + uHover * 0.12 + uPulse * 0.2);
    halo *= 1.0 + uLevel * 0.5 * sin(outside * 34.0 - uTime * 7.0);
    halo = clamp(halo, 0.0, 1.0) * (1.0 - body);
    vec3 glow = mix(uC1, uC2, 0.5);

    float alpha = body + halo;
    vec3 rgb = col * body + glow * halo;
    vec3 encoded = alpha > 0.0001 ? pow(max(rgb / alpha, 0.0), vec3(1.0 / 2.2)) * alpha : vec3(0.0);
    gl_FragColor = vec4(encoded, alpha);
  }
`;

const noSubscribe = () => () => {};

let webglSupport: boolean | null = null;
function supportsWebgl() {
  if (webglSupport === null) {
    try {
      const probe = document.createElement("canvas");
      webglSupport = !!(probe.getContext("webgl2") ?? probe.getContext("webgl"));
    } catch {
      webglSupport = false;
    }
  }
  return webglSupport;
}

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

// Used when WebGL isn't available or reduced motion is on: the same colours, holding still.
function StillOrb({ color, glow }: { color: TutorColor; glow: boolean }) {
  const palette = TUTOR_PALETTES[color];
  return (
    <span
      aria-hidden="true"
      className="block size-full rounded-full transition-[filter,background] duration-(--dur-tint)"
      style={{
        background: `radial-gradient(circle at 34% 30%, oklch(1 0 0 / 0.55), transparent 32%), radial-gradient(circle at 30% 70%, ${palette.c2}, transparent 60%), radial-gradient(circle at 72% 35%, ${palette.c3}, transparent 62%), ${palette.c1}`,
        boxShadow: `0 0 ${glow ? 48 : 28}px -6px ${palette.c1}`,
        filter: glow ? "brightness(1.12)" : "none",
      }}
    />
  );
}

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
  const container = useRef<HTMLSpanElement>(null);
  const reducedMotion = useReducedMotion();
  const webgl = useSyncExternalStore(noSubscribe, supportsWebgl, () => true);
  // The draw loop reads the latest props from here, so changing tutor or mode never rebuilds WebGL.
  const live = useRef({ color, mode, levels });
  const pulse = useRef(0);

  useEffect(() => {
    live.current = { color, mode, levels };
  }, [color, mode, levels]);

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
    const host = container.current;
    if (!host || reducedMotion || !webgl) return;

    let renderer: Renderer;
    try {
      renderer = new Renderer({ alpha: true, premultipliedAlpha: true, dpr: Math.min(window.devicePixelRatio || 1, 2) });
    } catch {
      return;
    }
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    host.appendChild(canvas);

    const start = paletteRgb(live.current.color);
    const colors: LinearRgb[] = start.map((rgb) => [...rgb] as LinearRgb);
    const program = new Program(gl, {
      vertex: VERTEX,
      fragment: FRAGMENT,
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: [1, 1] },
        uC1: { value: colors[0] },
        uC2: { value: colors[1] },
        uC3: { value: colors[2] },
        uLevel: { value: 0 },
        uListen: { value: 0 },
        uHover: { value: 0 },
        uPointer: { value: [0, 0] },
        uPulse: { value: 0 },
        uSwirl: { value: 0 },
      },
    });
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      if (width < 1 || height < 1) return;
      renderer.setSize(width, height);
      program.uniforms.uResolution.value = [gl.canvas.width, gl.canvas.height];
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    // Pointer: how close it is, and which way it lies from the orb's centre.
    let hoverTarget = 0;
    const pointerTarget = [0, 0];
    const onPointer = (event: PointerEvent) => {
      const bounds = host.getBoundingClientRect();
      const radius = bounds.width * 0.3;
      const dx = event.clientX - (bounds.left + bounds.width / 2);
      const dy = event.clientY - (bounds.top + bounds.height / 2);
      const distance = Math.hypot(dx, dy);
      hoverTarget = Math.min(Math.max(1 - (distance - radius) / (radius * 2.5), 0), 1);
      pointerTarget[0] = distance > 0 ? dx / distance : 0;
      pointerTarget[1] = distance > 0 ? -dy / distance : 0;
    };
    const onLeave = () => {
      hoverTarget = 0;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);

    let frame = 0;
    let level = 0;
    let listen = 0;
    let hover = 0;
    let swirl = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const state = live.current;
      const voice = state.levels?.() ?? { output: 0, input: 0 };
      const targets = paletteRgb(state.color);
      for (let index = 0; index < 3; index++) {
        for (let channel = 0; channel < 3; channel++) {
          colors[index][channel] = approach(colors[index][channel], targets[index][channel], 0.05);
        }
      }
      level = approach(level, state.mode === "speaking" ? Math.min(voice.output * 2.4, 1) : 0, 0.22);
      listen = approach(listen, state.mode === "listening" ? Math.min(voice.input * 2, 1) : 0, 0.2);
      hover = approach(hover, hoverTarget, 0.1);
      swirl = approach(swirl, state.mode === "thinking" ? 1 : 0, 0.04);
      pulse.current *= 0.93;

      const uniforms = program.uniforms;
      uniforms.uTime.value = now * 0.001;
      uniforms.uLevel.value = level;
      uniforms.uListen.value = listen;
      uniforms.uHover.value = hover;
      const pointer = uniforms.uPointer.value as number[];
      pointer[0] = approach(pointer[0], pointerTarget[0], 0.12);
      pointer[1] = approach(pointer[1], pointerTarget[1], 0.12);
      uniforms.uPulse.value = pulse.current;
      uniforms.uSwirl.value = swirl;
      gl.clear(gl.COLOR_BUFFER_BIT);
      renderer.render({ scene: mesh });
    };
    frame = requestAnimationFrame(draw);

    // Also runs when Next hides this page, so a hidden page never keeps drawing.
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("pointermove", onPointer);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [reducedMotion, webgl]);

  const still = reducedMotion || !webgl;

  // The canvas is larger than the orb, to leave room for its glow and wobble. Only the orb itself
  // (the middle 60%) takes clicks, so the glow never blocks drawing on the board.
  return (
    <span className={cn("pointer-events-none relative block", className)}>
      <span ref={container} aria-hidden="true" className="absolute inset-0">
        {still && (
          <span className="absolute inset-[20%]">
            <StillOrb color={color} glow={mode === "speaking"} />
          </span>
        )}
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
