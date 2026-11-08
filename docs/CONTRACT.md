# UI and back-end contract

This is how the Learning Grounds UI connects to ElevenLabs and Gemini. You can change the layout, styling and board as you like. Keep the seven points in "What the UI must keep" working.

## Run it

```bash
# Web, from web/
npm install
npm run dev

# API, from api/. Needed for reading uploaded homework and for Check my work.
uv run uvicorn main:app --reload --port 8000
```

| File | Setting | Where it comes from |
|---|---|---|
| `api/.env` | `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `GEMINI_API_KEY`, and the Auth0 and Canvas LMS settings in `api/.env.example` | Ask Lorenzo, or use your own Gemini key |
| `web/.env.local` | `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `AUTH0_AUDIENCE`, `APP_BASE_URL`, and optionally `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`) and `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` | Ask Lorenzo |

Never commit these files. A tutor session starts from a one-time credential the API gets from ElevenLabs (`POST /voice/session`), so the API must be running to talk to the tutor. Deploying is in [DEPLOY.md](DEPLOY.md).

## What the UI must keep

1. **Wrap anything that uses voice in `LgVoiceProvider`.** `ConversationPanel` already does this.
2. **Use `useLgVoice({ onLine })` from `web/lib/lg-voice.tsx` for the conversation.** It holds no UI, so you can restyle or replace the dock freely. Every transcript line goes to `onLine(who, text)`, with `who` as `student`, `tutor` or `system`; `chat-dock.tsx` saves them to the chat with `appendMessage`.

   | Field | What it does |
   |---|---|
   | `status` | `idle`, `connecting`, `listening` or `speaking` |
   | `connected`, `textOnly` | Whether a session is live, and whether it's a text-only session |
   | `error` | Message to show when a session fails |
   | `start(tutor, textOnly)`, `end()` | Start and end a session. `start` asks the API for a session credential first, and shows `error` if it can't get one. It always returns true |
   | `restartSession(tutor, textOnly)`, `switchTutor(tutor, textOnly)` | Replace the live session, such as to switch from text to voice or to another tutor |
   | `sendWhenReady(message)` | Send a typed message now, or when the connecting session opens. Typed messages aren't reported to `onLine`, so add them to the chat yourself |
   | `sendContextualUpdate(message)` | Background information the tutor uses but doesn't reply to. A connecting session gets it once it opens. Returns false and drops it when no session is live or connecting |
   | `streamingLine` | In a text chat, the tutor's reply as it streams in, word by word, with audio tags removed. `""` once `onLine` records the finished line, and always `""` in a voice call |
   | `muted`, `setMuted(value)` | Microphone mute |
   | `checkWork(region_id)`, `checking` | Check my work and its loading state. The UI has no button for it: students ask the tutor by voice or chat, and the tutor calls `read_student_work` |

   The tutor orb uses `useLgVoiceLevels()` from the same file, which is read-only and never starts, ends or changes a session:

   | Field | What it does |
   |---|---|
   | `live`, `speaking` | Whether a session is connected, and whether the tutor is speaking |
   | `getOutputLevel()`, `getInputLevel()` | The tutor's voice level and the student's microphone level, 0 to 1, and 0 with no session. Called every animation frame |

   Each session builds its prompt when it starts, with `buildTutorPrompt` in `web/lib/lg-tutor-prompt.ts`, from the tutor, the Student Profile and the open chat's homework (`homeworkContext(document)` in `lg-voice.tsx`, which is null with no homework). When pages finish reading during a live session, `chat-dock.tsx` sends the region list with `sendContextualUpdate(homeworkContextualUpdate(...))`, using `onLgHomeworkRead` from `lg-actions.ts`.

3. **Keep `applyLgAction(action)` in `web/lib/lg-actions.ts`.** Voice tools call it. Keep the action names and parameters, because they match `api/voice/tools.json` and the live ElevenLabs agent. See "The tutor's pen" below for how marks are drawn.
4. **Tag tutor shapes with `meta.author = "tutor"`.** `clear` and Check my work rely on this to tell them apart from the student's work.
5. **Tag fixed board shapes with `meta.kind`,** such as `"page"`, `"region"` or `"selection"` (a spot the student circled, below). Region shapes also need `meta.region_id`. Check my work uses these to find the student's marks and the page under them. Page images are locked image shapes with `meta.kind = "page"` and `meta.page`, created with `history: "ignore"` so undo can't remove them, and kept below everything else.
6. **Keep the `lg-board-link.ts` lines in `lg-actions.ts`.** They're the only back-end code in that file. If you rewrite it, add them back:

   ```ts
   import { lgSelectionBounds, linkLgBoard, noteLgActionTarget } from "./lg-board-link";

   // In applyLgAction, once the editor exists:
   noteLgActionTarget(action as { region_id?: string; near_region_id?: string });

   // In selectionTarget, which resolves a circled spot's ID (s1) for resolveTarget:
   const bounds = selection && lgSelectionBounds(id);

   // In recordLgSelection, once the circled spot is saved:
   noteLgActionTarget({ region_id: added.id });

   // In bindLearningGrounds, once the board is ready:
   const unlink = linkLgBoard(editor);
   // And in the cleanup function it returns:
   unlink();
   ```

7. **Keep region IDs such as `p1.q3`,** and keep box conversion in `web/lib/lg-regions.ts`. Tutors target region IDs, never coordinates. The app builds the IDs (`p{page}.q{k}`, in reading order on each page), never Gemini, and a page with no problems found, or not read yet, is one region `p{page}.page`. The regions live in the chat's document (below), and `lg-regions.ts` is the only module that turns `box_2d` into board positions.

## The tutor's pen

The tutor never drops a finished shape on the board. `applyLgAction` turns each action into steps for the tutor's pen (`web/lib/lg-tutor-pen.ts`), and the pen draws them by hand, one at a time, while the tutor talks. A cursor in the tutor's colours shows where the pen is (`web/components/tutor-cursor.tsx`, mounted as tldraw's `InFrontOfTheCanvas`).

- **Geometry** is in `web/lib/lg-ink.ts`: hand-drawn loops, underlines, highlighter passes, arrow arcs, plain lines, number lines, the answer box, graph axes, the shapes for `draw_shape` and the check marks for `mark_work`. Graphs are in `web/lib/lg-plot.ts`. Neither has tldraw imports, so `node --test lib/lg-ink.test.ts lib/lg-plot.test.ts` runs them.
- **Timing:** in a voice call, a mark waits up to 700 ms for the tutor to start speaking, so ink and voice begin together. When the student interrupts, the rest of the queue plays three times faster. A text chat never waits.
- **The student comes first:** while the student's pen is down (any tool but select and hand), the tutor's pen waits.
- **Undo:** tutor marks are made outside tldraw's undo history, so the student's undo only ever removes their own work. Before this change, undo could remove a tutor mark.
- **Finishing at once:** switching chats, hiding the tab or reduced motion finishes every queued mark immediately, so a board is never saved with half a mark.
- **Region outlines** are still created as locked shapes (point 5), but they're always invisible. The tutor aims at regions; the student never sees the boxes.

| Action | Parameters | What the student sees |
|---|---|---|
| `focus_region` | `region_id` | The board glides there and the pen flies along |
| `point_at` | `region_id` | The pen taps with a ripple, leaving no ink |
| `circle_region` | `region_id` | A hand-drawn loop |
| `underline_region` | `region_id`, `text?` | A slightly bowed underline: under just that phrase when `text` is given (below), else under the whole problem |
| `highlight_region` | `region_id`, `text?` | A highlighter swipe over just that phrase, or back and forth down a tall problem |
| `draw_arrow` | `from_region_id`, `to_region_id`, `label?` | The arrow grows along its curve, then its label is written |
| `draw_line` | `from_region_id`, `to_region_id`, `label?`, `dashed?` | A straight line with no arrowhead grows between the two items' nearest edges, dashed when asked, then its label is written. A question counts with its answer box |
| `mark_work` | `region_id`, `verdict` (`correct`, `incorrect` or `check_again`) | A green check, a red cross or a question mark in the tutor's colour, drawn by hand just right of the student's writing on that problem or in that answer box, or right of a circled spot |
| `write_text` | `near_region_id`, `text` | Handwriting in the margin, letter by letter |
| `write_math` | `near_region_id`, `latex` | KaTeX in the tutor's colour, revealed left to right (`web/components/lg-math-shape.tsx`) |
| `number_line` | `near_region_id`, `min`, `max`, `marks?` | The axis and ticks drawn left to right, then the numbers, then a dot for each mark |
| `plot_graph` | `near_region_id?`, `functions`, `x_min`, `x_max`, `y_min?`, `y_max?`, `points?` | The x axis (520 ms) and y axis (440 ms) with their ticks, the numbers (90 ms each), each curve left to right in its own colour (about 900 ms a curve), then a dot and a label for each point |
| `draw_shape` | `near_region_id?`, `shape`, `labels?`, `parts?`, `shaded?` | The outline by hand (500 to 1100 ms), then a fraction's dividers (140 ms each) and shaded parts (220 ms each), the right-angle marker, radius or dashed height, then the labels, letter by letter |
| `clear` | none | The tutor's marks and questions, and the spots the student circled, fade out. The student's work stays |
| `get_student_progress` | none | The pen thinks in the middle of the view while the tutor looks up the student's Canvas LMS info. It returns a report to the tutor and leaves no mark |

Every ID above can also be the ID of a question the tutor wrote (`q1`) or of a spot the student circled (`s1`), both below.

### Graphs and shapes

`plot_graph` and `draw_shape` draw a figure of about 280 × 220 board units, which fits the margin beside a problem. With `near_region_id`, it goes in that region's or question's margin, below what's already written there. Without one, or with an ID that isn't on the board, it goes on a free spot, chosen when its first step starts, as a question's is. Both use tldraw's own `draw` and `text` shapes, tagged `meta.author = "tutor"`, so `clear` removes them and no shape util has to stay registered.

- **Functions** are read by a tokenizer and a precedence parser in `lg-plot.ts`, never with `eval` or `Function`. They take numbers, `x`, `+ - * / ^`, brackets, implicit multiplication (`2x`, `3(x+1)`, `x(x-1)`), `sin cos tan sqrt abs ln log exp`, `pi`, `e` (so `2e` is 2·e, and `1e3` is an error) and an optional `y=` or `f(x)=`. Anything else is logged, and nothing is drawn.
- **Curves** are sampled 200 times and break where the function isn't defined or jumps, so `1/x` and `tan x` have no line through their asymptotes. With no `y_min` and `y_max`, the y range fits the curves and points, leaving out an asymptote's tails. Curves 2 and 3 use the tutor's other colours, never black, which is the student's pen. Ticks are numbered every 1, 2, 5 or 10 steps, as far apart as the widest number needs, each in a box as wide as its text, and an axis on the top or right edge has its numbers outside the plot.
- **Shapes** label sides in order: a rectangle or square's bottom, then right; a right triangle's upright leg, bottom leg, then long side; a triangle's base, then the other sides, with `h=` drawing its height dashed. A circle takes `r=` or `d=`. A label for the whole shape (`A=`, `P=`, `area=` or `perimeter=`, with a capital A or P), and any past the last side, goes under it. Two numbers set a rectangle's or triangle's proportions. Fraction models have 1 to 12 `parts`, and the first `shaded` ones are filled.

### Exact phrases

`/documents/read-page` returns each problem's printed lines with their own boxes (`lines`, at most 12 per problem). `pageRegions` keeps the valid ones on the region as `lines`, within the same text budgets as the region's own text, each line whole or not at all so its text always matches its box. With `text`, `underline_region` and `highlight_region` mark just those words: `phraseBoxes` in `lg-regions.ts` finds the line, or lines, holding the phrase, comparing letters, digits and math symbols without spaces, case or accents (so `1/2` never finds `12`), and forgiving about one character in five on a longer phrase. It estimates where the words fall from their place among the line's characters. When the region has no lines (a question, a circled spot, or homework read before lines were), or the phrase isn't found, the whole region is marked, as before. `node --test lib/lg-regions.test.ts` runs it.

### What to practice

`get_student_progress` runs `runStudentProgress()` in `web/lib/lg-progress-run.ts`. The tutor calls it when the student asks what to work on, asks for practice, or asks for help without naming a problem while no homework is open. When they name a topic, such as slope, it skips the lookup and takes that topic. Then it writes a practice problem with `ask_question` and sets it up on the board in the same reply.

1. The pen thinks in the middle of the view until the report is ready (`lookAtLgBoard` in `lg-actions.ts`).
2. Fresh Canvas LMS data gets about 4 seconds: the calendar feed is refreshed (`GET /canvas-lms/calendar-feed`, a 409 when none is saved), then the OAuth import is tried (`GET /canvas-lms/profile`, through `fetchCanvasLmsProfile`, which only adds courses and refreshes Coming up, and leaves name and school alone). Both fail quietly, and then the saved profile is used.
3. The report (`progressReport` in `lg-tutor-prompt.ts`) holds the courses, upcoming work, the chat's Canvas LMS assignment, "Finds hard", checks across all chats that found a mistake or an unfinished answer, and recent practice questions from every chat, newest first with this chat's first, so the tutor doesn't repeat one. The pure parts (`wrongChecks`, `recentPractice`) are in `lg-progress.ts`. It names its source and says that grades aren't available.

Each Check my work result is saved with the problem's text (`topic`, up to 120 characters) and the time (`at`). Each chat keeps its last 10 question texts in `practice_history`, which `clear` doesn't empty.

**`lg-math` shapes:** `write_math` adds a custom tldraw shape. Boards saved with one won't load without its util, so keep `LgMathShapeUtil` in `shapeUtils` on `<Tldraw>`.

### Questions on the board

`askLgQuestion(question, near_region_id?)` in `lg-actions.ts` writes a question for the student: a note in the tutor's colour, then "Your answer" in the session's language and a dashed box to answer in. With `near_region_id`, it goes in that region's margin. Without one, or with no homework open, it goes on a free spot of the board. That's how the tutor teaches on a blank board.

- It returns the question's ID at once (`q1`, `q2` and so on, never reused within a chat). The voice tool `ask_question` hands the ID to the tutor.
- Questions are saved with the chat as `board_questions`, so `read_student_work("q1")` and the other tools still find them after a reload. `clear` removes the questions and circles that were on the board when it was called. One the tutor writes in the same reply, such as `clear` then `ask_question`, survives the fade-out.
- `captureLgRegion("q1")` captures the question's note and what the student wrote in or near its answer box, with every stroke of a drawing that reaches the box (`growCluster` in `lg-selection.ts`): each pen stroke is its own shape, so a graph drawn beside the box comes whole, not just the stroke that crossed it.
- `read_student_work("board")` (`LG_BOARD_ID` in `lg-board-link.ts`) checks whatever the student drew on their screen, with the homework page under it, or all their marks when none are on screen. It's for "can you see my drawing?" when the drawing isn't a problem, an answer box or a circle. Its report has no mark line, since there's no one spot to mark.
- **Marks aimed at a missing ID:** drawing tools don't wait for an answer, so a mark whose ID isn't on the board used to fail silently while the tutor thought it drew. `applyLgAction` now gathers such marks for 300 ms and `onLgMarksDropped` fires; `chat-dock.tsx` sends the tutor a `[Board]` contextual update naming them and listing the IDs on the board (`droppedMarksUpdate` in `lg-tutor-prompt.ts`).
- When the student writes in an answer box and stops for 4 seconds, `onLgAnswerWritten` fires. `chat-dock.tsx` then sends `[Answer written] ... q1` during a live session, and the tutor checks the answer without being asked.

### Show the tutor (student circles)

The pencil menu's **Show the tutor** tool (`LgPointTool`, id `lg-point`, in `web/lib/lg-point-tool.ts`, registered with `tools={[LgPointTool]}` on `<Tldraw>`) lets the student point at anything on the board: a tap leaves a small ring, and a drag a loop that closes itself. The geometry (closing the loop, its bounds, the minimum size of a tap, and what the spot is on) is in `web/lib/lg-selection.ts`, which `node --test` runs.

- **The mark** is a tldraw `draw` shape in a light blue dashed style, created outside the undo history, with `meta.kind = "selection"` and `meta.selection_id`. Because it has a `meta.kind`, it never counts as the student's work, and it doesn't start a chat or move the focus region by itself, so `recordLgSelection` in `lg-actions.ts` does both.
- **Saved with the chat** as `board_selections`: `{ id, bounds, region_id?, question_id?, created_at }`, with IDs `s1`, `s2` and so on, never reused within a chat (`board_selection_count`), and the last 20 kept. A spot on a question the tutor wrote belongs to the question, otherwise to the region there (`regionAt` in `lg-regions.ts`, which matches the printed problem, then its working area, never the margin). When a board opens, loops the chat no longer lists are removed.
- **Tutor tools** take `s1` like any ID. Its bounds come from the loop on the board, which moves with its file, or from the saved bounds when the loop is gone. Notes about it go in the margin of its region or question, with that problem's other notes. `read_student_work("s1")` checks just what's inside the loop, labelled "the part the student circled on Problem 3", and `captureLgRegion("s1")` crops to the loop, with the page and the student's marks there but not the loop or the tutor's marks. `clear` removes the loops too.
- **The tutor reacts by itself.** `onLgSelection` fires when a loop is finished. `chat-dock.tsx` sends `[Student circled] s1, on Problem 3 (p1.q3), around the student's own writing.` (or "on the printed problem, with none of the student's writing") as a contextual update at once, so a question the student then asks is about that spot. After 2 seconds, if no student line arrived, the chat draft is empty and the microphone stayed quiet, it sends the same words as a message, which starts a text chat when no session is live. That costs agent credits.
- **Each session's prompt** lists the spots on the board in a `<selections>` block.

### Changing the tools

`api/voice/tools.json`, `clientTools` in `lg-voice.tsx` and the `LgAction` union must name the same tools with the same parameters. Tools that return a result to the tutor (`ask_question`, `read_student_work` and `get_student_progress`) aren't board actions, so they're in `tools.json` and `clientTools` only. After changing them, run `uv run scripts/elevenlabs_setup.py agent` from `api/` to update the live agent. Ship the web change and the agent change together, because a web build that doesn't know a tool fails when the tutor calls it.

The debug panel (`components/tutor-actions.tsx`, in the sidebar in development) has a button for every tool, so each one can be tested without voice.

## Homework

Uploads go through `uploadLgHomework(file)` in `web/lib/lg-actions.ts`, and the upload dialog shows its progress with `subscribeLgUpload` and `getLgUpload`.

A chat's homework can hold several files. Uploading again adds the new file beside the others instead of replacing them: its pages are numbered after the existing ones (so region IDs stay unique, such as `p3.q1` for the first problem of a second file's first page), and they go in a new column to the right, with room for margin notes (`placeNewFile` in `lg-regions.ts`). Pages of an earlier file that weren't read yet are read along with the new one.

Students can move and remove files on the board:

- **Moving** goes through `startLgFileMove`, `moveLgFileBy` and `endLgFileMove`. A file's pages move together, with their region outlines and every mark on them or in their margins, and the new positions are saved in the document. The page images stay locked, so tldraw's own tools still can't move them.
- **Removing** goes through `removeLgFile`. It deletes the file's pages, outlines and the tutor's marks on it, and the spots circled on it with their `s` IDs. The student's own marks stay. Removing the last file removes the homework, as `removeLgDocument` does.
- **Where files are on screen** comes from `getLgFiles` and `subscribeLgFiles`. `components/board-files.tsx` uses it for the move handles and the selected file's toolbar.
- **Saved positions:** when a board opens, the document and the board are reconciled. The board saves a moment after the chat, so after a quick reload the page positions on the board win, and pages the document no longer lists are removed.

1. `web/lib/lg-document.ts` checks the file by its bytes: PDF, PNG, JPG or WEBP, up to 20 MB and 10 pages. It renders each page to an image of about 2000 px on the long side, with pdf.js for PDFs (loaded only in the browser, with its worker bundled by `new Worker(new URL(...), import.meta.url)`) and with a photo's EXIF rotation applied.
2. Each page image is stored with `editor.getAssetForExternalContent`, so it's saved in the chat board's IndexedDB under its `persistenceKey`, and placed as a locked page image. The pages are usable at once, with one whole-page region each.
3. The pages are read one at a time with `POST /documents/read-page`, and the chat's regions are replaced page by page. A page that fails keeps its whole-page region, and the dialog offers **Read again**. Readings are cached in localStorage (`lg-read-cache-v2`) by file hash, page and language, so uploading the same file again makes no API call. Version 2 added the lines, and the version 1 cache is removed on first use.

The chat's document, saved with the chat in localStorage:

| Field | What it holds |
|---|---|
| `filename`, `page_count`, `hash` | Every file's name, comma-separated, the total page count, and the SHA-256 of the first file's bytes, which identifies the homework while it's read |
| `files[]` | `{ id, filename, hash, page_count }` for each file. Missing on homework saved before several files were allowed, where `documentFiles()` in `lg-regions.ts` treats it as one file |
| `status` | `reading` while pages are being read, else `ready` |
| `pages[]` | `{ number, w, h, read, x, y, file, source }`: each page's size in board units (portrait and landscape both work), whether it was read (`pending`, `done` or `failed`), where it sits on the board, which file it came from, and its page number inside that file, which keys the reading cache. Pages saved before files could move have no `x`, `y`, `file` or `source`, and stack down from the top |
| `regions[]` | `{ region_id, label, page, box_2d, text, lines? }`. `box_2d` is `[ymin, xmin, ymax, xmax]` on a 0–1000 scale of the page. `lines` is `[{ text, box_2d }]`, each printed line of the problem; homework read before lines were has none |

If a reopened board has the document but not its page images, for example after site data was cleared, the document is dropped and a system line in the chat asks the student to upload the file again.

## API endpoints

The image endpoints take multipart form data. All answer errors as `{ "detail": string }`. A 422 has `detail` as an array, so check its type before showing it.

| Endpoint | Fields | Returns |
|---|---|---|
| `POST /check-work` | `image` (PNG snapshot), `label`, `language` (optional: `pt`, `es` or `en`) | `{ status, student_wrote, analysis, hint }` |
| `POST /voice/session` | JSON `{ "text_only": bool }` | `{ conversation_token, signed_url }`: a token for a voice call (WebRTC) or a signed URL for a text chat (WebSocket); the other is null. 503 when the API has no ElevenLabs key or agent ID, 502 when ElevenLabs refuses |
| `POST /documents/read-page` | `image` (PNG, JPEG or WEBP, up to 10 MB), `language` (`pt`, `es` or `en`), `page` (1 to 999) | `{ page, page_text, problems: [{ label, box_2d, text, lines: [{ text, box_2d }] }] }`. `problems` and `lines` may be empty. Lines come from the same Gemini call, at most 12 per problem of up to 160 characters, each on its problem; a longer line is dropped, not cut |

`read-page` errors are 413 (too large), 415 (wrong type), 400 (corrupt image) and 502 (Gemini busy or failed, with a message safe to show the student). A page takes about 15 s and up to about 60 s, so the web app waits up to 90 s.

## Changing the board

`web/lib/lg-board-link.ts` is the only back-end file that uses tldraw. If you replace tldraw, keep these four functions and rewrite what's inside them:

- `linkLgBoard(editor)` connects the back end when a board opens, and returns a function that disconnects it.
- `captureLgRegion(region_id)` returns a PNG of the student's work on that region, without the tutor's marks. It includes the homework page under it, cropped to the region's working area: the problem and the space below it, down to just above the next problem or the page bottom. For a spot the student circled (`s1`), it's cropped to the loop instead. It returns `"no_work"` when the student hasn't written anything there. With no homework open, it captures all of the student's marks on the board.
- `lgSelectionBounds(selection_id)` returns where a circled spot is now: its loop's bounds, which move with its file, or the saved bounds when the loop is gone, and null for an ID the chat doesn't list.
- `lgSelectionHasWork(selection_id)` says whether the student's own marks are inside the loop, so the tutor hears whether they circled their work or the printed problem.

## Optional

- **Follow the current problem:** `useLgFocusRegion()` returns the region in use. It follows the tutor's marks and the student's pen, falls back to the open homework's first region, and is `""` with no homework open.
- **Unused export:** `VOICE_OPTIONS` in `lg-types.ts` is no longer used. The tutor editor reads `web/lib/lg-voices.ts`. It's there so older UI code still builds, and you can delete it once nothing imports it.

## Merging

Both of us should keep commits small and pull often.

**If a merge conflicts:**

| File | What to do |
|---|---|
| `web/package-lock.json` | Accept either version, then run `npm install` in `web/` and commit the result |
| `web/package.json` | Keep the dependencies from both sides |
| `.gitignore` | Keep the lines from both sides |
| `web/components/conversation-panel.tsx` | Keep the UI's markup, and connect it to `useLgVoice()` |
| `web/components/tutor-editor.tsx` | Keep the UI's markup. Keep the voice menu's logic: it uses `voiceOptions` and `findVoice`, changing language clears `voice_id`, and Preview plays `preview_url` |
| `web/lib/lg-actions.ts` | Keep the UI's version, and add back the lines from point 6 |

**After every merge, check it still works:**

```bash
cd web && npx tsc --noEmit && npx eslint lib components app && npm run build
node --test lib/*.test.ts
cd ../api && uv run pytest
```

Then upload a PDF, start a text-only session, ask the tutor to circle problem 3, and ask it to check your work. In a new chat with no homework, ask the tutor for a practice problem: it should write a question with an answer box, and check what you write there.
