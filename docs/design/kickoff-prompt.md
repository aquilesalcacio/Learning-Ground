Build the design system for Learning Grounds, the web app in `web/` of this repo: a homework tutor with a voice, which draws on a shared whiteboard with the student.

Read these first:
- `docs/design/brief.md`: the look, the rules, the tutor orb, and a map of every screen you'll design. It's the source of truth, so check your work against its Rules.
- `docs/CONTRACT.md`: what the UI must keep so voice, homework reading and Check my work keep working. You can change all styling and layout. Don't break anything it lists.
- `docs/design/21st/`: the components I saved from 21st.dev, with a README giving each one's role and the changes it needs. Adapt them to the system. Don't paste them in unchanged.

**Above all, it should be simple and extremely interactive.** There are few controls, but everything responds: the orb, the dots, the chat bar, the menus and the cards all react to the student in playful, dynamic ways. The brief's "Making it interactive" section has starting ideas. A screen that just sits still has missed the point.

The direction in one line: a modern lab, like an iPhone commercial. It sits on a warm, light-grey dot grid with a faint multicolour tint. Each tutor is a floating, many-coloured orb that morphs when it speaks, and the colours of the tutor you pick set the mood of the screen. Chat surfaces are glassy and blurred. Light theme only.

## Setup
- Create a `design-system` branch from the latest `voice-agent`. Pull before you start, because my teammate Lorenzo pushes to `voice-agent` often.
- Stack: Next 16 (with Cache Components), React 19, Tailwind 4, shadcn `base-nova` on Base UI, tldraw 5, and the ElevenLabs React SDK.
- Run `npm install` in `web/`. Add `ogl` for the orb, plus whatever Shining text needs. Ask me before adding anything else.
- There's no ElevenLabs agent ID on this machine. To test the orb's speaking and listening states, use a simulated voice level on `/design`. The tutor editor's voice preview plays real audio, so it's a second way to check.

## How to work
Work in the phases below, one at a time. After each phase:
1. Run the checks from `docs/CONTRACT.md`. In `web/`: `npx tsc --noEmit`, `npx eslint lib components app`, `npm run build` and `node --test lib/*.test.ts`.
2. Take screenshots at desktop (1280 px) and phone (390 px) widths. Look at them yourself before you show me.
3. Stop and show me what changed, with the screenshots. Wait for my go-ahead before starting the next phase.

Commit each phase separately, with small commits. Don't push. I'll push myself, because it needs the repo owner's sign-in.

### Phase 1: Foundations
- **Tokens:** replace the shadcn grey tokens in `web/app/globals.css` with:
  - colours: a warm neutral base, the dot grid and its tint, and the glass surface
  - type scale and spacing
  - radius, shadows and motion durations
  - focus ring
- **Tutor palettes:** a five-part palette for each of the five tutor colours in `TUTOR_COLORS` (`web/lib/lg-types.ts`). Keep `COLOR_HEX` working.
- **`/design` page:** a development-only page that shows every token and, as later phases add them, every component in every state. This is where I'll review your work.

### Phase 2: The tutor orb
Build one `TutorOrb` with:
- **Sizes:** hero, docked, card and mini.
- **Renderers:** WebGL (hero and docked) and CSS (card, mini, and the fallback).
- **States:** idle, listening, thinking and speaking.

Add read-only voice levels to `useLgVoice`, as the brief describes, and record them in `docs/CONTRACT.md`.

The orb must:
- respect reduced motion
- pause while its page is hidden (Next keeps hidden pages alive) or off-screen
- keep only one WebGL orb live at a time

### Phase 3: Board screens
Do sections B, C and D of the page map:
- the start screen with the hero orb
- the docked orb while working
- the glass chat bar, transcript, popovers and upload dialog
- the dot grid on the tldraw board, matching the page's dots exactly
- tutor marks in palette colours

### Phase 4: Sidebar
I haven't decided how the sidebar should look. Prototype two or three distinct directions on `/design`, explain the trade-offs of each, and wait for me to choose. Then build the chosen one (section A).

### Phase 5: Tutor pages
Do sections E and F: the Tutors page with orb cards, and the tutor editor with a live orb preview that plays the voice preview.

### Phase 6: Polish
- **Interaction pass:** go screen by screen. Anything the student can touch that doesn't respond yet gets feedback, using the brief's interaction ideas.
- **Motion:** make animations consistent across screens.
- **Contrast:** AA contrast for text on glass over every tutor tint.
- **Keyboard:** every control reachable, with visible focus.
- **Phone:** a performance check at phone width.
- **For Lorenzo:** a short style note in `docs/design/`, so his Auth0 login page matches.

## Boundaries
- Don't change how sessions, homework reading, chat history or the board behave. That's the logic in:
  - `web/lib/lg-voice.tsx` (apart from the read-only voice levels)
  - `lg-store.ts`
  - `lg-actions.ts`
  - `lg-board-link.ts`
  - `lg-document.ts`
  - `lg-regions.ts`
  - the session logic in `chat-dock.tsx`

  If a design needs a behaviour change, ask me first.
- Don't add buttons, panels or shortcuts for things the student can ask the tutor by voice or chat, such as "check my work" or "give me a hint". Voice, the chat bar and the board are the whole interaction (brief, Rule 9). This includes Check my work: `docs/CONTRACT.md` mentions a button for it and a `ConversationPanel`, but both were dropped on purpose. The tutor checks work when the student asks.
- Leave Student Profile and the login page alone.
- Original visuals only. Use the iPhone commercial as a mood, and use no Apple, Amazon or other brand assets, marks, sounds or lookalikes.
- If anything in the brief is unclear or conflicts with the code, ask me rather than guess.
