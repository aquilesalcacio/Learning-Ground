# UI and back-end contract

This is how the Learning Grounds UI connects to ElevenLabs and Gemini. You can change the layout, styling and board as you like. Keep the seven points in "What the UI must keep" working.

## Run it

```bash
# Web, from web/
npm install
npm run dev

# API, from api/. Needed only for Check my work.
uv run uvicorn main:app --reload --port 8000
```

| File | Setting | Where it comes from |
|---|---|---|
| `web/.env.local` | `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` | Ask Lorenzo |
| `api/.env` | `ELEVENLABS_API_KEY`, `GEMINI_API_KEY` | Ask Lorenzo, or use your own Gemini key |

Never commit these files. Without the agent ID, the panel shows an error when you start a session, and everything else still runs.

## What the UI must keep

1. **Wrap anything that uses voice in `LgVoiceProvider`.** `ConversationPanel` already does this.
2. **Use `useLgVoice()` from `web/lib/lg-voice.tsx` for the conversation.** It holds no UI, so you can restyle or replace `conversation-panel.tsx` freely.

   | Field | What it does |
   |---|---|
   | `status` | `idle`, `connecting`, `listening` or `speaking` |
   | `connected` | Whether a session is live |
   | `lines` | The transcript, with `who` as `student`, `tutor` or `system` |
   | `error` | Message to show when a session fails |
   | `start(tutor, textOnly)`, `end()` | Start and end a session |
   | `switchTutor(tutor, textOnly)` | Start a new session with another tutor |
   | `sendText(message)`, `addLine(who, text)` | Send a typed message, and show it in `lines`. Call both, because typed messages aren't added for you |
   | `muted`, `setMuted(value)` | Microphone mute |
   | `checkWork(region_id)`, `checking` | The Check my work button and its loading state |

3. **Keep `applyLgAction(action)` in `web/lib/lg-actions.ts`.** Voice tools call it. Keep the action names and parameters, because they match `api/voice/tools.json` and the live ElevenLabs agent.
4. **Tag tutor shapes with `meta.author = "tutor"`.** `clear` and Check my work rely on this to tell them apart from the student's work.
5. **Tag fixed board shapes with `meta.kind`,** such as `"page"` or `"region"`. Region shapes also need `meta.region_id`. Check my work uses these to find the student's marks.
6. **Keep the five `lg-board-link.ts` lines in `lg-actions.ts`.** They're the only back-end code in that file. If you rewrite it, add them back:

   ```ts
   import { linkLgBoard, noteLgActionTarget } from "./lg-board-link";

   // In applyLgAction, once the editor exists:
   noteLgActionTarget(action as { region_id?: string; near_region_id?: string });

   // In bindLearningGrounds, once the board is ready:
   const unlink = linkLgBoard(editor);
   // And in the cleanup function it returns:
   unlink();
   ```

7. **Keep region IDs such as `p1.q3`,** and keep box positions in `web/lib/lg-regions.ts`. Tutors target region IDs, never coordinates.

## Changing the board

`web/lib/lg-board-link.ts` is the only back-end file that uses tldraw. If you replace tldraw, keep these two functions and rewrite what's inside them:

- `linkLgBoard(editor)` connects the back end when a board opens, and returns a function that disconnects it.
- `captureLgRegion(region_id)` returns a PNG of the student's work on that region, without the tutor's marks. Include any homework page image, so Gemini can read the problem. It returns `"no_work"` when the student hasn't written anything there.

## Optional

- **Follow the current problem:** `useLgFocusRegion()` returns the region in use. It follows the tutor's marks and the student's pen. The Check my work button already uses it. The Regions list in `learning-grounds-view.tsx` doesn't yet, so its highlight can differ from the button.
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
cd web && npx tsc --noEmit && npx eslint lib components && npm run build
cd ../api && uv run pytest
```

Then start a text-only session, ask the tutor to circle problem 3, and click Check my work.
