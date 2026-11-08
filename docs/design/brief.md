# Learning Grounds design brief

This brief is the source of truth for the design system. Check every screen against the **Rules** below before asking for review.

## The idea
Learning Grounds should feel like a modern lab in an iPhone commercial: clean and bright, with a lot of air around things. It should also be fun, never sterile.

The **tutors are the stars.** Each tutor is a floating orb, like a smart-speaker light, and it morphs when the tutor speaks. Every tutor has its own set of colours. The tutor a student picks sets the colour of the whole screen.

## Rules
1. **The background is a dot grid.** It's a light grey that leans warm, never blue or cold. A faint wash in the active tutor's colours sits over it, quiet enough that text stays easy to read.
2. **The tutor orb is the most important thing on any screen where it appears.** Nothing else competes with it in colour or motion.
3. **Colour comes from tutors.** The rest of the interface stays neutral: warm greys, white glass and dark text. Colour appears in orbs, the background tint, tutor marks on the board, selected states and focus rings.
4. **Chat surfaces are glass:**
   - the chat bar
   - the transcript
   - popovers
   - dialogs

   Glass here means a blurred, see-through panel with a thin light edge and a soft shadow. Text on glass must stay readable over any tutor tint (WCAG AA contrast).
5. **Simple, but alive.** There are few controls on screen, and every one of them responds when touched. The app should feel playful and dynamic, like the product is happy to be used. Every press, hover, drag, send and tutor switch gets visible, springy feedback, and the orb reacts to what the student does, not just to the tutor's voice. Motion is lively, not noisy:
   - It never blocks or slows the student down.
   - It never moves the homework under their pen.
   - Only one big thing moves at a time.

   With reduced motion on, keep the feedback but replace movement with fades and colour changes. The orb holds still and only changes brightness.
6. **Light theme only.** Still name every colour as a token, and never hard-code a colour in a component.
7. **Original work.** Use the "iPhone commercial" as a mood only. Use no Apple, Amazon or other brand assets, marks, sounds or lookalike logos.
8. **The board must stay usable.** Homework pages, tutor marks and the student's own strokes must read clearly on the dot grid at every zoom level.
9. **Voice and the chat bar are the only way to ask for anything.** The student talks or types to the tutor, and draws and writes on the board. That's the whole interaction. Don't add buttons for things the tutor can do on request, such as checking work, explaining or giving a hint. For example, "can you check my work?" said or typed already makes the tutor check (`read_student_work`). Board tools, upload, tutor choice and session controls are the only controls.
10. **Follow `docs/CONTRACT.md`.** It lists what the UI must keep so voice, homework reading and Check my work keep working. Styling and layout are yours to change. The rules it sets:
   - **Voice:** the `useLgVoice` fields.
   - **Board shapes:** the `meta.author` and `meta.kind` tags.
   - **Page images:** locked, kept below everything else.
   - **Region IDs:** keep the format, such as `p1.q3`.
   - **`lg-board-link.ts`:** keep its lines in `lg-actions.ts`.

   Run its checks after every merge.

## Tutors and colour
- The code has five tutor colours: `blue`, `red`, `green`, `orange` and `violet` (`TUTOR_COLORS` in `web/lib/lg-types.ts`). Their single hex values live in `COLOR_HEX` there.
- Turn each colour into a **palette**:
  - three orb colours, which can wander into nearby hues for a multicolour feel
  - a background tint
  - an accent for selected states and focus
  - a mark colour for drawing on the board, readable on white paper
- Keep `COLOR_HEX` working, because the board and pencil menu use it. Point it at the new palette instead of removing it.

## The orb
| State | When (what the code knows) | Look |
| --- | --- | --- |
| Idle | No session, or a session with nobody speaking | Slow breathing, gentle colour drift |
| Listening | Voice call, student speaking (`getInputVolume()` above a threshold) | Leans toward the student, reacts lightly to the mic level |
| Thinking | A student message was sent and no reply has started | Shimmer or swirl, and shining status text |
| Speaking | `status === "speaking"`, driven by `getOutputVolume()` / `getOutputByteFrequencyData()` | Morphs and pulses with the tutor's real voice |

`useLgVoice` in `web/lib/lg-voice.tsx` already gives `status`, `connected`, `textOnly` and `muted`. The audio levels come from the SDK's `useConversation`, which the hook doesn't pass on yet. Add a read-only way to read them, such as `getOutputLevel()` and `getInputLevel()`, without changing how sessions behave. Then add the new fields to the `useLgVoice` table in `docs/CONTRACT.md`, because Lorenzo owns that hook too.

## Making it interactive
These are starting ideas for Rule 5, not a fixed list. Prototype them on `/design`, keep the ones that feel good, and suggest better ones.

**The orb reacts to the student, not only the tutor:**
- It leans toward the pointer and wobbles when clicked or tapped.
- It pulses softly while the student types.
- It perks up (grows a little brighter) when a file is dragged over the screen.
- It does a small happy bounce when a session starts.

**Switching tutor:**
- The orb morphs from one palette to the next.
- The tint sweeps across the dot grid in the new tutor's colours.

**Dot grid:**
- The dots near the pointer brighten or swell slightly, like a light passing over them.
- Behind the orb, they ripple outward while the tutor speaks.

**Chat bar:**
- Buttons press in with a spring.
- A sent message lifts into the transcript.
- The mic button glows with the student's voice level during a voice call.

**Pencil menu:**
- The chosen tool pops.
- Colour swatches bounce when picked.
- Undo and redo give a quick nudge.

**Upload:**
- The drop zone's dots gather toward the file as it's dragged in.
- The pages land on the board with a small settle.
- Each problem's outline appears as it's read.

**Tutor cards and editor:**
- Cards tilt slightly with the pointer.
- The orb preview reacts as each setting changes, before the voice preview is played.

**Limits:**
- **Board effects stay off the student's work:** nothing animates over the homework while the student is drawing.
- **Each effect stays quick:** an effect that repeats often lasts under about 300 ms.
- **Phones:** check that all of it stays smooth.

**Sizes:**
- **Hero:** start screen and tutor editor.
- **Docked:** next to the chat bar while working.
- **Card:** Tutors page.
- **Mini:** tutor pill, tutor switcher and chat list.

**Renderers:**
- **WebGL** for the hero and docked sizes.
- **CSS** for card and mini sizes, and as the fallback when WebGL is missing, the device is weak, or reduced motion is on.
- Only one WebGL orb is live at a time.

## Page map
Every screen to design. Login (another teammate is building it) and Student Profile are out of scope.

### A. App shell
Files: `web/components/app-shell.tsx`, `app-sidebar.tsx`.

| Part | Today | Design treatment |
| --- | --- | --- |
| Page background | Flat white | Warm dot grid plus the active tutor's tint, shared by every page |
| Sidebar, open | Plain white column with a border | Its own phase: prototype 2–3 directions and wait for a choice |
| Sidebar, retracted | Small round button, top left | Small glass button |
| Sidebar on phones | Overlay with a grey backdrop | Glass overlay with a blurred backdrop |
| Sidebar contents | New chat, Tutors, chat list (colour dot, title, tutor, date, delete), user details | Chat list shows a mini orb per tutor. User details only take the new tokens |
| Test tutor actions | Collapsed panel, development builds only | Tokens only. It's a developer tool |

### B. Start screen
`/` with no active chat. File: `web/components/learning-grounds-view.tsx`.

| Part | Today | Design treatment |
| --- | --- | --- |
| Greeting | Bold text in the centre | **Hero orb, idle**, with the greeting below it in display type |
| Board behind | Blank tldraw canvas | tldraw draws a dot grid that exactly matches the page's dots, so starting work causes no visible jump |
| Tutor pill | Outline pill with a colour dot | Glass pill with a mini orb. Switching tutor re-tints the orb and the background |
| Chat bar | White rounded bar: pencil, upload, input, mic, send | **Glass bar.** States: empty, typing, connecting, text chat, voice call, muted |
| Error banner | Red text in a white box. Shows session errors, such as a missing agent ID | Glass banner in the warning colour. Words for students, not developers |

### C. Working board
`/` with an active chat.

| Part | Today | Design treatment |
| --- | --- | --- |
| Board, no homework | Strokes on a blank canvas | Dot grid |
| Board with homework | The real pages, as locked tldraw image shapes (`meta.kind = "page"`). Problems found by Gemini become regions, outlined as locked shapes (`meta.kind = "region"`) that the student can hide | Pages look like paper lifted slightly off the grid, for example a soft shadow behind each page image. Softer region outlines. **Don't change the shapes' tags, locking or order**, because the contract needs them |
| Current problem | None. `useLgFocusRegion()` in `lg-board-link.ts` knows the problem in use | Optional: a gentle highlight in the tutor's colour on the current problem |
| Tutor marks | One flat tutor colour | The palette's mark colour |
| Orb | None | **Docked orb** by the chat bar, showing listening, thinking and speaking |
| Transcript | White blurred card | Glass card. Tutor and student lines differ by colour and alignment. System lines (session started or ended, homework notices) are quieter. "Thinking" uses shining text |
| Session status | Dot and label in the bar | The orb shows it. Keep a text label for screen readers |

### D. Popups over the board
| Popup | Today | Design treatment |
| --- | --- | --- |
| Pencil menu | 7 tools, 6 colours, background, page jump, undo/redo/clear | Glass popover. Token swatches and a tinted selected state |
| Upload homework | Dialog with a dashed drop zone. Takes a PDF or photo (PNG, JPEG, WEBP), up to 10 pages and 20 MB | Glass dialog with a dot-pattern drop zone. Design every state in `upload-dialog.tsx`: empty, dragging over, "Opening file…", the pages on the board while "Reading your homework, page 2 of 5…", "N problems found across N pages", pages that couldn't be read with **Read again**, Remove, and errors (wrong file, too large, API unreachable). Reading uses shining text |
| Tutor switcher | Tutor list plus Modify tutors | Glass popover with a mini orb per tutor. Hovering a tutor previews its tint |

### E. Tutors
`/tutors`. File: `web/components/tutors-view.tsx`.

| Part | Today | Design treatment |
| --- | --- | --- |
| Header | Title, subtitle, New tutor | Display type. New tutor is the primary button |
| Tutor cards | White cards: dot, name, Preset badge, details, Edit, Select | **Glass cards led by a card-size orb.** Only the selected tutor's orb animates |
| Phone | One column | Same, with smaller orbs |

### F. Tutor editor
`/tutors/[id]`. File: `web/components/tutor-editor.tsx`.

| Part | Today | Design treatment |
| --- | --- | --- |
| Header | Back link, name, autosave note | **Live hero orb** that changes as you edit |
| Identity | Name and colour swatches | Swatches show the whole palette |
| Voice and language | Language, voice, Preview voice | The voice preview plays through the orb, which morphs with it |
| Teaching | Tone, style, personality | Glass card, standard fields |
| Rules every tutor follows | Read-only list | Quieter "locked" style |
| Delete tutor | Red button (custom tutors) | Destructive token |
| Tutor not found | Heading and back link | Empty state with a dim orb |

### G. `/design` (new, development only)
A reference sheet showing:
- every token
- both orb renderers in every state, with a slider that fakes the voice level
- every component above in all its states
- the sidebar options side by side

The user reviews each phase here.

### H. Not designed
- **Login:** Lorenzo is building it, with Auth0.
- **Student Profile:** out of scope for now.
- **404 page:** Next's default.

## The 21st.dev components
Reference copies are in `docs/design/21st/`, and the README there gives each one's role and the changes it needs. Adapt them to this system. Don't paste them in unchanged.
