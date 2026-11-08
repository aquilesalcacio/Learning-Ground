# 21st.dev reference components

These are the components the project owner saved from 21st.dev. They're kept here as **reference only**: outside `web/` and not part of the build. Each file is the original code, with duplicate pastes removed and the mixed-up parts separated. None of it has been fixed yet.

| File | Source | Role in Learning Grounds | Must change before use |
| --- | --- | --- | --- |
| `voice-powered-orb.tsx` | 21st.dev (WebGL with `ogl`) | Hero and docked tutor orb | See the list below |
| `siri-orb.tsx` | 21st.dev (CSS conic gradients) | Card and mini orbs, and the fallback renderer | Rename the `Component` default export to a named export. Move the inline `<style>` into CSS. Take colours from the tutor palette. Add the morph states. Make reduced motion keep a still orb, not an empty one |
| `dot-pattern.tsx` | 21st.dev (SVG) | Dot grid on the start screen and other pages | Dot colour, size and spacing come from tokens. Replace the loose `any` prop types. The board needs a tldraw background that matches it |
| Shining text | https://21st.dev/@preetsuthar17/components/shining-text (no code saved) | "Thinking…" and other status text | Get it with the shadcn CLI from that page. If that fails, ask the project owner to paste the code |

## Changes the voice-powered orb needs
- **Remove its own microphone.** It calls `getUserMedia` with echo cancellation off. That would compete with the ElevenLabs session's microphone, ask the student for permission a second time, and react to the student, not the tutor. Drive it from levels passed in by props: the tutor's output level and the mic input level from the ElevenLabs SDK.
- **Colours:** replace the single `hue` uniform (a hue rotation of three fixed colours) with three colour uniforms from the tutor palette.
- **Changing props:** update uniforms in place. Don't tear down and rebuild the WebGL context, which today happens on every `hue` change.
- **Hidden or off-screen:** pause the animation loop when the page is hidden. Next keeps hidden pages alive, so the effect cleanup runs then.
- **No WebGL:** fall back to the CSS orb when WebGL isn't available.
- **Leftover bug:** it opens the microphone twice, once in each of its two effects. Removing the microphone (above) gets rid of this too.
- **File fixes:**
  - `"use client"` must come first.
  - `useRef<number>()` needs an initial value in React 19.
  - Remove the `any` casts and console logs.
  - Resize with a `ResizeObserver` on the container, not the window.
