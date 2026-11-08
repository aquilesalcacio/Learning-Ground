# Learning Grounds: Product Vision & MVP Scope

> **Status:** v0.2, Fri 2026-11-06, 8:30 PM EST. Hacking ends Sun 10:00 AM, about 37 hours away. Feature freeze is Sat 11:00 PM, about 26 hours away.
> **Team:** Lorenzo (L), Aquiles (A). **Event:** SharkByte 2026, details in `~/SharkByte-Event-Plan.md`.
> **Parent of:** `ARCHITECTURE.md`, `FLOWS.md`, `STACK.md`, `CONTRACT.md`. Section 13 says what each one inherits.

## 0. Glossary (read this first)

| Term | Meaning | Never call it |
|---|---|---|
| **Learning Grounds** | The shared homework board where tutor and student write and draw. Also the app's name. | "the canvas" |
| **Canvas LMS** | Instructure's learning management system. Always use the full name. | "Canvas" alone |
| **Region** | A located item on a homework page, such as Problem 3, with an ID like `p1.q3` | "box", "coordinates" |
| **Tutor** | A student-configured persona: voice, language, tone, style | "agent" in UI copy |
| **Action** | One typed drawing command the tutor can issue on Learning Grounds | "tool call" in UI copy |

**Code naming:** use `learning_grounds` / `lg_*` for the board and `canvas_lms_*` for the LMS. Don't use a bare `canvas` identifier. tldraw's docs say "canvas" for their own engine; that word stays out of our code and docs.

**Name collision:** the app and its main page share one name. That works for the weekend. Before launch, decide whether the page needs its own name, such as "Board".

---

## 1. Critique of v0.1

Ordered by how much each one changes the plan.

### Findings that change the plan

1. **"Solve your homework" is the wrong promise.** In a randomized trial with nearly 1,000 high school math students, a plain GPT-4 tutor improved practice scores by 48% but made exam scores 17% worse. A guarded tutor improved practice by 127% and largely removed the exam harm ([PNAS, Bastani et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC12232635/)). You're also demoing on a college campus. **Change:** the pitch becomes "works through it *with* you", hint-first by default (section 5).
2. **That study also gives us a design.** The guarded tutor's prompt contained each problem's solution and common mistakes, plus instructions not to reveal the solution. Our vision pre-processing can generate the same material. **Change:** pre-processing now produces a hidden tutor brief as well as region locations (section 8.3).
3. **Canvas LMS is settled, and v0.1 was wrong about it.** I proposed students pasting a personal token. Instructure's guide says: "It is a violation of Canvas API policy for a user to generate an access token to insert into an application" ([source](https://community.instructure.com/en/kb/articles/662901-how-do-i-manage-api-access-tokens-in-my-user-account)). The free Canvas Lite account has no API either. **Change:** under your own rule, Student Profile is manual for the MVP (section 9).
4. **The demo depends on a feature you marked optional.** v0.1's step 5, where the tutor spots the student's sign error, needs row 6 (the snapshot), now "if time is available". **Change:** the demo is split into a core path and a stretch step (section 6), and row 6 has a cheap design (section 8.4).
5. **Auth0 was tied to the wrong thing.** Your rule, "Auth0 if the Canvas LMS API works", follows from my v0.1 framing, but the two are unrelated. Auth0 logs people into our app. **Change:** under your rule Auth0 is off. The prize is a separate call (section 14, Q3).
6. **`~/SharkByte-Event-Plan.md` still describes the old project.** It describes calendar agents, Pydantic AI, Agent Elements, and a Google Calendar demo. **Change:** its project, stack and demo sections need rewriting, or future sessions will follow them.

### Weaknesses now addressed

7. **Chat was scoped as a Claude.ai clone.** "Most of Claude's tools" is a product of its own and isn't what makes this different. The ElevenLabs SDK has a text-only mode and `sendUserMessage`, so one conversation component can serve both Chat and Learning Grounds (section 8.2).
8. **The stack didn't reflect the voice decision.** With ElevenLabs hosting the conversation, the backend gets much smaller. Pydantic AI is no longer needed for the MVP, and Gemini can still run as the voice model inside ElevenLabs (section 7).
9. **The agent was going to reason about coordinates.** It shouldn't. The tutor refers to region IDs and code converts them to positions (section 8.3).
10. **Math was missing.** The tutor needs to write equations on the page and also say them aloud. LaTeX rendering and spoken math each need handling (section 8.5).
11. **The venue was ignored.** A hackathon floor is loud, and voice detection will struggle. This is now a named risk with a plan (section 12).
12. **tldraw's license needs a decision.** A deployed tldraw app needs a license key, and it isn't open source, while your event rule allows "open-source libraries and APIs" (section 7).
13. **Customization had no safeguard.** A fully editable system prompt lets a student remove the teaching guardrails. The prompt is now split into a locked core and an editable persona (section 5).

### Still weak

- **No user validation.** Nobody outside the team has confirmed students want this. Ten minutes with other hackers on Saturday would give you a real quote for judges.
- **Not unique on technology alone.** [Agent Draw](https://daily.dev/posts/agent-draw-an-agent-draws-while-you-talk-built-on-tldraw-czix0pd0a) already draws while you talk, built on tldraw. Our edge is the combination: the student's own assignment, a guided tutor, a persona, and three languages.
- **Efficacy is unproven for everyone.** A University of Toronto study found Khanmigo's AI tutor "didn't add anything" on top of Khan Academy practice, partly because students barely used it (reported via a competitor's comparison page, citing [Hechinger](https://hechingerreport.org/proof-points-khanmigo-math-ai-tutor/); I didn't read the original). Don't claim learning gains. Claim the design choice and cite the evidence behind it.

---

## 2. Pitch

**One line:** A tutor you design talks you through your real homework and draws on the page with you, in Portuguese, Spanish or English.

**Problem:**
- Chat tutors can't point at anything, yet problem solving is visual and spoken.
- Answer-giving AI can hurt exam results (section 1, finding 1).
- Human tutors are expensive and unavailable at 11 PM.
- Non-native English speakers get less help in the language they think in.

**Competitors** (from comparison pages, some written by rivals, so check before quoting):

| Product | Strength | Gap we target |
|---|---|---|
| Khanmigo ($4/mo) | Never gives answers; voice | Tied to Khan Academy content; one comparison found no PDF upload |
| ChatGPT Study Mode | Free, accepts uploads | Optional, and has no shared drawing on your page in what I reviewed |
| Gemini Guided Learning | Free, in Google Classroom | Same as above; opt-in per chat |

I didn't test these products, so "no shared drawing" is from their published descriptions, not hands-on use.

## 3. Users

- **Primary:** community college and university students working on math or science problem sets, especially PT and ES speakers. Miami Dade College is the natural first audience, and it uses Canvas LMS ([MDC](https://www.mdc.edu/remote-learning-students/canvas/)).
- **Not in the MVP:** minors (a major compliance area), teachers, parents, institutions.

**Primary job:** "I'm stuck on one problem tonight and I want to understand it, not just get it done."

## 4. Pillars

### 4.1 Learning Grounds (the core)
A page-based board with the assignment as a locked background.
- **Tutor:** circles, points, writes text and math, and pans to the right spot while speaking.
- **Student:** draws and types freely, with tutor marks in the tutor's color.
- **Always available:** voice and a chat box in the same conversation.
- **MVP customization:** only background and pen color. More can wait.

### 4.2 Tutors
Cards leading to an editor. Each trait must audibly or visibly change the session, or it gets cut.

| Trait | Implementation |
|---|---|
| Name, color | Our DB; color applies to tutor marks |
| Voice | ElevenLabs `voice_id` override, with preview |
| Language (PT/ES/EN) | ElevenLabs `language` override |
| Tone (casual, humorous, formal) | Persona prompt fragment |
| Teaching style | Persona prompt fragment; see section 5 |
| Personality | Free text, in the editable prompt layer only |

Ship 3 presets, so the demo needs no setup. Suggestion: "Prof. Ana" (PT, casual), "Don Mateo" (ES, formal), "Sam" (EN, humorous).

### 4.3 Chat
A thin page reusing the same conversation component as Learning Grounds, with voice on or off. The tutor can offer to "open this on Learning Grounds". Graphs and docs sit below the cut line (section 11, row 9).

### 4.4 Student Profile
Manual form: name, school, courses, preferred language, what's hard for you. The values feed the prompt at session start through ElevenLabs dynamic variables. Canvas LMS is a roadmap item (section 9).

## 5. Teaching stance

Three prompt layers, in this order:

1. **Locked core (students can't edit):** guide first; never give a final answer before the student attempts it; check the work; use the hidden brief without reciting it.
2. **Persona (editable):** name, tone, personality.
3. **Session context:** student profile, region list, hidden brief.

**Teaching style options:** Socratic, worked example on a *similar* problem, or visual-first. There's deliberately no "just give me the answer" mode. If a student insists, the tutor shows the next single step.

**Honest limit:** prompts don't guarantee behavior, and a determined student can extract answers. Say so if judges ask. Integrity features such as flagging graded work come later.

## 6. Demo (3 minutes)

Rehearse on a prepared calculus PDF whose regions and solutions you've checked by hand.

**Core path, which must work:**
1. **Problem (15 s):** "AI that hands you the answer can make your exam scores worse. Tutors that guide don't have that problem."
2. **Pick tutor (15 s):** Choose Prof. Ana, a Portuguese casual tutor. Show the editor for a moment.
3. **Upload (20 s):** The PDF appears and regions are detected, with a brief visible highlight so judges see the intelligence.
4. **Talk (60 s):** "Tô travado na questão 3." The tutor pans there, circles it while speaking in Portuguese, and writes a hint in the margin *without giving the answer*.
5. **Switch (20 s):** Swap to Sam in English on the same problem. This proves customization in seconds.
6. **Close (20 s):** Technical point and what's next.

**Stretch step, only if row 6 ships:** after step 4, the student writes a step, taps **Check my work**, and the tutor catches the sign error with an arrow.

**Fallbacks:** typed input if the room is too loud, a hotspot if Wi-Fi fails, and the recorded video as a last resort.

**Honesty rule, per your event plan:** anything mocked gets called mocked in the demo.

**Judging fit:**

| Criterion | Evidence |
|---|---|
| Technical complexity | Voice, live drawing and vision-derived regions working in sync |
| Innovation | Tutor acts on the student's own page, guided by a hidden brief |
| UI/UX | Marks appear as the tutor speaks; tutors feel distinct |
| Practical utility | Works on real homework, three languages, grounded in published evidence |

## 7. Stack

| Layer | Choice | Status and reasoning |
|---|---|---|
| Frontend | Next.js, Tailwind, shadcn, 21st.dev | Already decided |
| Backend | FastAPI: tokens, upload, vision, tutor CRUD | Decided; smaller than planned |
| DB | Postgres on Easypanel | Decided. Could be cut to JSON for one user, but it's already in the plan |
| Voice | ElevenLabs Agents, `@elevenlabs/react` | Decided. Established vendor. WebRTC for voice |
| Voice LLM | **Gemini 3.8 Flash inside ElevenLabs** (recommended) | Listed as natively supported. Start here and compare only if the delay is noticeable |
| Vision pre-processing | **Gemini 3.8 Flash called directly** | Google documents `box_2d` output as `[ymin, xmin, ymax, xmax]` scaled 0-1000. Runs at upload, so it can't delay voice |
| Board | **tldraw** (recommended), Excalidraw fallback | See below |
| PDF | `pdfjs-dist`, each page rendered to an image | Used by tldraw's own PDF example |
| Math | KaTeX in a custom shape | Mature. Needs a small spike |
| Agent framework | Pydantic AI: **deferred** | Nothing in the MVP needs it now. A single direct Gemini call handles vision |
| Auth | Auth0 (updated Nov 7) | Universal Login (Google + email) guards every page via `web/proxy.ts`; FastAPI checks RS256 access tokens in `api/auth.py` |

Your Gemini decision was to leave it for later unless it causes no delay. This split respects that: the direct Gemini call runs outside the voice path, and the model inside ElevenLabs is a swappable setting. Direct use also supports the Gemini MLH entry.

**tldraw vs Excalidraw**

| | tldraw | Excalidraw |
|---|---|---|
| License | Source-available; production needs a key. Free 100-day trial key is issued immediately; hobby license is discretionary and watermarked ([terms](https://tldraw.dev/community/license)) | MIT, no key |
| PDF annotation | Official [example](https://tldraw.dev/examples/pdf-editor): pages as locked images, export back to PDF | No equivalent found |
| Programmatic drawing | `editor.createShape`, stable Editor API | Skeleton API, labeled "beta and subject to change" in its docs |
| Reading the board | `editor.toImageDataUrl()` | Export utilities exist; not checked |
| Custom shapes (math) | Supported | Not checked |

**Recommendation:** tldraw on a trial key. It's the shorter path to the demo moment, by a lot. **Before Aquiles starts, ask an organizer one question:** "Is a source-available SDK with a free trial key allowed under the open-source libraries rule?" If not, use Excalidraw. The action layer (section 8.1) keeps that switch contained. Also note in the README if you adapt tldraw's example code, since the event requires code to be written during the weekend.

## 8. Architecture

```
Browser (Next.js)
 ├─ Conversation component ── WebRTC ──► ElevenLabs Agent (STT, turn-taking, Gemini, TTS)
 │     clientTools ◄──────────────────── tool calls
 │        │
 │        ▼
 ├─ applyLgAction()  ← the seam between L and A
 │        ▼
 ├─ Learning Grounds (tldraw + locked PDF page images)
 │
 └─ HTTPS ► FastAPI ─┬─ POST /documents → render pages → Gemini vision → regions + brief
                     ├─ POST /conversation-token (keeps the ElevenLabs key server-side)
                     ├─ CRUD /tutors, /profile → Postgres
                     └─ POST /check-work (snapshot → Gemini → text)   [row 6]
```

### 8.1 Action contract (row 1, the first hour)

The tutor never sends coordinates. Everything targets a region ID.

| Action | Parameters | Wait for response? |
|---|---|---|
| `focus_region` | `region_id` | No |
| `circle_region` | `region_id` | No |
| `draw_arrow` | `from_region_id`, `to_region_id`, `label?` | No |
| `write_text` | `near_region_id`, `text` | No |
| `write_math` | `near_region_id`, `latex` | No |
| `clear` | none; removes tutor marks only, never the student's | No |
| `add_image` | `near_region_id`, `url` | Below cut line |
| `read_student_work` | `region_id` | **Yes** (row 6) |

**Why the last column matters:** ElevenLabs documents that without "wait for response" the agent "assumes success and continues the conversation". That's what lets speech keep going while drawing happens. A blocking tool is only for when the tutor needs an answer back.

**The seam:** Aquiles owns `applyLgAction(action)`. Lorenzo's client tools only call it. Aquiles can test with debug buttons before voice exists, and Lorenzo can test by logging actions before the board exists. Tag each shape with `meta.author = 'tutor'` so that `clear` is safe.

**Client tool names must match the ElevenLabs agent configuration exactly**, per the SDK docs. Keep the list in `CONTRACT.md`.

### 8.2 Conversation and tutors

- **One ElevenLabs agent, many tutors.** Tutors live in Postgres. At session start, pass overrides for prompt, first message, language and voice. Each override must first be enabled in the agent's Security tab, or the session throws an error. ElevenLabs recommends dynamic variables as the preferred way to personalize, so use those for profile fields.
- **Switching tutors** ends the session and starts a new one. Sessions don't share memory, so pass a short summary across if the demo needs continuity.
- **Useful SDK features confirmed in the docs:**
  - `sendContextualUpdate`: informs the tutor without prompting a reply, such as "student switched to page 2".
  - `sendUserMessage`: powers the typed chat box.
  - `sendUserActivity`: pauses the agent about 2 seconds. Fire it while the student is drawing, so the tutor doesn't talk over them.
  - `onAudioAlignment`: character-level speech timing, which could sync marks to words. Polish only.
  - `textOnly`: Chat with voice off, with no microphone prompt.
- **Exposure note:** overrides travel through the browser, so a technical student could read the hidden brief in dev tools. Acceptable for the MVP. Later, serve the brief server-side.

### 8.3 Pre-processing

At upload, per page, with a limit of about 10 pages:

1. Render to an image with `pdfjs-dist`.
2. Send it to Gemini with a schema.
3. Validate, then store.

```json
{
  "region_id": "p1.q3",
  "label": "Problem 3",
  "box_2d": [120, 80, 310, 920],
  "text": "Find the derivative of ...",
  "brief": {
    "solution_steps": ["..."],
    "common_mistakes": ["..."]
  }
}
```

**Coordinates:** `box_2d` is `[ymin, xmin, ymax, xmax]` on a 0-1000 scale for the page. To position in tldraw: `x = page.x + xmin / 1000 * page.w`, and `y` the same way with `page.h`. This is independent of zoom and pan. Only one module does this conversion.

**To the tutor:** pass region ID, label, text and brief. Never pass the numbers.

**Failure ladder:** Gemini box → student taps the region to select it → the tutor describes it verbally without marking. Boxes may be loose on dense pages, so `circle_region` should pad them slightly.

**Solution accuracy:** generated solutions can be wrong. The demo PDF is checked by hand. In real use, the tutor should treat the brief as a guide and be able to say "let me re-check that".

### 8.4 Seeing the student's work (row 6)

Continuous vision is out of scope. **Use an explicit "Check my work" button:**

1. `editor.toImageDataUrl()` captures the region (documented in tldraw 4.0).
2. FastAPI sends the image, problem text and brief to Gemini, and gets text back.
3. `sendUserMessage` delivers it, such as "Student work on p1.q3: [analysis]", and the tutor responds in its own voice.

ElevenLabs does support images natively in a conversation ([docs](https://elevenlabs.io/blog/processing-images-and-documents-in-elevenagents)), but its write-up describes that for custom chat clients, and I couldn't confirm it during a live WebRTC voice call. The button route avoids that uncertainty and keeps one vision pipeline.

### 8.5 Math

- **On the page:** `write_math` renders KaTeX in a custom tldraw shape.
- **Aloud:** the locked prompt must say to speak math in words, such as "x squared", and never read LaTeX. Test this in all three languages early.
- **In marks:** keep what the tutor writes short. A margin isn't a whiteboard.

### 8.6 Data model

```
Tutor(id, name, color, voice_id, language, tone, style, persona_prompt, is_preset)
StudentProfile(id, name, school, courses[], language, struggles)
Document(id, filename, page_count, status)
Page(id, document_id, number, image_url, width, height)
Region(id, page_id, region_key, label, box_2d, text, brief_json)
```

Board state stays in the browser for the MVP and doesn't persist across reloads.

### 8.7 Latency budget

Targets, none measured yet. Spike 1 fills in actual numbers.

| Moment | Target |
|---|---|
| Student stops speaking → tutor audio starts | Under 1.5 s |
| Tool call → mark visible | Under 200 ms |
| Upload → regions ready | Under 15 s per page; show progress |

**Unknown:** whether a mark appears before, during or after the matching sentence. Docs don't settle this, and it's the first thing to measure. Keeping thinking effort low helps, since ElevenLabs warns that extra reasoning can delay turn-taking.

## 9. Canvas LMS: research result

> **Update, Sat Nov 7.** We now connect Canvas LMS through the approved route below: OAuth2 with a Developer Key, on our own Canvas LMS instance, where we're admin. FastAPI runs the flow (`api/canvas_lms.py`, routes `/canvas-lms/*`). It stores only each student's tokens, keyed by their Auth0 user, and imports name, school, courses and upcoming assignments into the Student Profile on demand. Students never paste tokens. Instructure removed API access and user tokens from Free-for-Teacher accounts on 2026-05-04, so a free teacher account can't be used. Real schools would still need to enable our Developer Key, and MDC would be the first conversation.

**Result: manual Student Profile for the MVP, following your rule.** I didn't test against MDC's own instance.

| Route | Verdict | Why |
|---|---|---|
| Student generates a token and pastes it | **No** | Violates Canvas API policy per Instructure's guide. Some schools also block students: [UW](https://uwconnect.uw.edu/it?id=kb_article_view&sysparm_article=KB0034590), [St. Edward's](https://support.stedwards.edu/TDClient/96/Portal/KB/Article/6479/Canvas-API-Access-Tokens) |
| Canvas Lite free account for a demo | **No** | User-generated tokens and API access aren't supported ([same guide](https://community.instructure.com/en/kb/articles/662901-how-do-i-manage-api-access-tokens-in-my-user-account)) |
| Workarounds for schools that disabled tokens | **No** | They exist online. Don't use them: they circumvent school policy and would be a bad thing to show judges |
| OAuth2 with a developer key | **Right route, not this weekend** | The [approved method](https://developerdocs.instructure.com/services/canvas/oauth2/file.developer_keys). Needs a key enabled by each institution, or a global one from Instructure |
| Self-host open-source Canvas LMS with fake data | **Technically possible, not worth it** | Hours of setup for a mock with extra steps |
| Calendar feed URL | **Possible post-MVP** | From memory, students can copy an iCal link from the Canvas LMS calendar. Not rechecked, including its terms |

**What to do instead:**
- **Weekend:** student downloads the assignment PDF from Canvas LMS and uploads it. It takes seconds and it's how the demo starts anyway.
- **Pitch line:** "Canvas LMS integration goes through an institution-approved OAuth or LTI app, and MDC would be our first conversation." That's a stronger answer than a hack, and the MDC North Campus Challenge might make the conversation real.
- **If you show an Import button,** label it as a concept.

**Privacy:** grades and coursework can be FERPA-protected education records, as UW's policy notes. The MVP stores none of it from Canvas LMS. Uploaded homework still goes to ElevenLabs and Google, so don't demo with anyone's real graded work. Note that the Gemini free tier uses prompts to improve Google products, so use the paid tier your plan already calls for.

## 10. Cost

| Item | Facts | Plan |
|---|---|---|
| ElevenLabs Agents | Free: 15 min/mo. Starter: $6 ($1 first month), 75 min. Creator: $22 ($11 first month), 275 min. Paid plans work out to $0.08/min, plus LLM at cost ([pricing guide](https://elevenlabs.io/blog/ai-voice-agent-pricing-guide)) | 15 minutes won't survive development. **Start on Creator,** or Starter if you're careful. Confirm at checkout; these figures were machine-extracted from the guide |
| Gemini | Tier 1 with your existing spend caps. Prices last checked Nov 2 | Cache pre-processing per document |
| tldraw | Free trial key | One per commercial unit |

**Habit:** test drawing with debug buttons and typed input, and only use voice when testing voice.

## 11. Work split

**Your assignments.** I kept row numbers where you replaced them with letters, so dependencies still resolve.

| # | Owner | Feature | Depends on |
|---|---|---|---|
| 1 | **A + L** | Learning Grounds action contract (section 8.1) | none |
| 2 | **A** | PDF upload + page render | none |
| 3 | **A + L** | PDF vision pre-processing (regions, brief) | 2 |
| 4 | **A** | Learning Grounds (tldraw + PDF layer), tutor marks appear live | 1 |
| 5 | **L** | ElevenLabs voice session + client tools wired to Learning Grounds | 1, 4 |
| 6 | **Delegated, if time** | Snapshot so the tutor can see student writing | 4 |
| 7 | **L** | Tutors list + editor | none |
| 8 | **Unassigned** | Chat | 7 |
| 9 | **Unassigned** | Chat tools: graphs, docs. Below the cut line | 8 |
| 10 | **Unassigned** | Student Profile (manual) | none |
| 11 | **Built Nov 7** | Canvas LMS OAuth2 import on our own instance (section 9 update) | 12 |
| 12 | **Built Nov 7** | Auth0 login + API token checks, for the MLH "Best Use of Auth0" prize | none |
| 13 | **Unassigned** | Seeded data + demo PDF, checked by hand | 2, 3 |

**Things I noticed in the split:**
- **Rows 5 and 7 are heavy React work, and they're both on Lorenzo,** who has said JS isn't their strength. Row 7 especially: v0.1 had Aquiles building that UI. Consider Aquiles building the Tutors UI from their component library while Lorenzo does CRUD and voice mapping. Your call.
- **Row 13 has no owner and the demo can't happen without it.** Assign it first.
- **Row 5 needs a voice dock UI** (mic button, speaking indicator, chat box). The owner was left blank in your table.
- **Row 6 "delegated" to whom?** It needs a name, or nobody will pick it up.
- **Row 3 is shared.** Suggested line: Lorenzo owns the Gemini call and schema; Aquiles owns the highlight display and coordinate conversion.

### Build order and gates

| Gate | When | Proof | If it fails |
|---|---|---|---|
| **G0: Rule check** | Tonight, before coding | Organizer answers the tldraw question | Use Excalidraw |
| **G1: Voice draws** | Tonight, 2-hour limit | Hard-coded region; say "circle problem 3"; the mark appears as the tutor speaks. Record latency | Try WebSocket mode, then block on the tool. If still broken by Sat 9 AM, fall back to typed input with spoken replies |
| **G2: Locating** | Sat 10 AM | 5 real homework pages; correct regions on at least 4 | Tap-to-select |
| **G3: Core demo** | Sat noon, on the deployed URL | Section 6 steps 1-4 end to end, in Portuguese | Cut everything else |
| **G4: Switch + tutors** | Sat 6 PM | Step 5 works; editor changes persist | Presets only, read-only editor |
| **G5: Freeze** | Sat 11 PM | Bugs only from here | |
| **Submit** | Sun 8-9 AM | Video, README, Devpost per event plan | |

G1 comes first because every other part depends on it, and it's the one thing nobody has seen working.

## 12. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Marks lag behind speech | Unknown | High | G1 measures it first; non-blocking tools; prompt tutor to mark, then explain |
| Noisy venue breaks voice detection | High | High | Headset mic; mute toggle with `setMuted`; typed fallback; rehearse in the actual room |
| Region detection is loose or wrong | Medium | High | G2 test; padded marks; tap-to-select; hand-checked demo PDF |
| Tutor gives away the answer on stage | Medium | High | Locked core prompt; rehearse attempts to extract it |
| Generated solution is wrong | Medium | Medium | Hand-checked demo; tutor can self-correct |
| tldraw not allowed, or key problem | Low | High | G0; `applyLgAction` isolates the library |
| Math read aloud as LaTeX | Medium | Medium | Prompt rule; test early in all 3 languages |
| Portuguese or Spanish quality disappoints | Unknown | Medium | Test PT and ES voices during G1. ElevenLabs lists 31 languages, but I haven't checked regional accents |
| ElevenLabs minutes run out | Medium | Medium | Paid plan; debug buttons for non-voice testing |
| Lorenzo blocked on React | Medium | Medium | Clear seam; SDK hook examples; pair at sync points; rebalance row 7 |
| Wi-Fi fails | Medium | High | Hotspot; recorded video |

## 13. Doc roadmap

| Doc | Inherits from here | Must add |
|---|---|---|
| `CONTRACT.md` (write first) | Sections 8.1, 8.3, 8.6 | Endpoint shapes; exact tool definitions; TypeScript and Pydantic types |
| `STACK.md` | Section 7 | Versions; env vars; Easypanel services; ElevenLabs agent settings |
| `ARCHITECTURE.md` | Section 8 | Sequence diagrams; error handling; measured latency |
| `FLOWS.md` | Sections 4, 6 | Screens and states: empty, loading, mic denied, upload failed |
| `PROMPTS.md` (new) | Section 5 | The actual locked core; persona fragments; PT/ES/EN versions |
| `~/SharkByte-Event-Plan.md` (update) | Sections 6, 7, 11 | Replace project, stack, demo and required path |

## 14. Open questions

1. **Rule check:** does tldraw's license fit the event rule? Ask an organizer tonight.
2. **Owners:** who takes rows 6, 8, 9, 10, 13 and the voice dock? Do you want to rebalance row 7?
3. **Auth0:** drop it, per your rule, or add it just for the prize? It's wireless headphones per member, and login is otherwise unused in the demo. My recommendation is to drop it unless you're ahead at G4.
4. **Hint-first as a fixed default:** do you accept that there's no "just give me the answer" mode?
5. **Subject scope:** math only for the demo? I recommend it. PDF layouts and spoken math are already enough to validate.
6. **MDC North Campus Challenge:** does the brief announced at the ceremony fit this project? It could shape the pitch.
7. **Student-facing name** for the board if the app keeps the same name. Can wait.

## 15. Beyond the MVP

- **Tutor memory:** what you struggled with last week, using ElevenLabs post-call webhooks to store summaries and dynamic variables to bring them back.
- **Practice generation:** new problems targeting your mistakes.
- **Canvas LMS OAuth or LTI app,** institution by institution.
- **Teacher view** and academic integrity controls.
- **Non-PDF input:** photos of handwritten homework.
- **Live vision** instead of the button.
