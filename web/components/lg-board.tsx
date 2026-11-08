"use client";

import { type TLAnyShapeUtilConstructor, type TLComponents, Tldraw } from "tldraw";
import "tldraw/tldraw.css";
import { LgMathShapeUtil } from "@/components/lg-math-shape";
import { TutorCursor } from "@/components/tutor-cursor";
import { bindLearningGrounds } from "@/lib/lg-actions";
import { boardPersistenceKey } from "@/lib/lg-store";

// Every piece of tldraw's own chrome is off. The chat dock's pencil menu is the
// only toolbar, which is what leaves the page itself uncluttered. Background and
// LoadingScreen are off too, so the board is see-through and the app's dot grid
// stays behind the student's work.
const components: TLComponents = {
  Background: null,
  LoadingScreen: null,
  MainMenu: null,
  PageMenu: null,
  HelpMenu: null,
  DebugMenu: null,
  DebugPanel: null,
  SharePanel: null,
  StylePanel: null,
  Toolbar: null,
  NavigationPanel: null,
  ActionsMenu: null,
  QuickActions: null,
  ZoomMenu: null,
  MenuPanel: null,
  TopPanel: null,
  HelperButtons: null,
  Minimap: null,
  // The tutor's cursor, over the board and under the app's own chrome.
  InFrontOfTheCanvas: TutorCursor,
};

// The tutor's equations. Boards saved with one need this util to load, so it stays registered.
const shapeUtils: TLAnyShapeUtilConstructor[] = [LgMathShapeUtil];

// tldraw needs a license key on any domain but localhost. Without a valid one, tldraw 5 hides the
// whole board five seconds after it loads. The key is public by design: it ships in the browser
// bundle. This is our trial key (any domain, until 2027-02-16). A key set in the environment wins,
// unless it isn't a real tldraw key, such as the template's YOUR_TLDRAW_KEY placeholder.
const TLDRAW_TRIAL_LICENSE_KEY =
  "tldraw-2027-02-16/WyJ2YVZYOHRxZiIsWyIqIl0sMTYsIjIwMjctMDItMTYiXQ.kJ3JueDfvp7XEwg9PBT2IHTxkf5wuPC1fVJ+4IogLK96i4CU5+731tSqCILEtnjwEM2Nk3Cthp9pcLtqG8eW6w";
const envLicenseKey = process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY?.trim();
const licenseKey = envLicenseKey?.startsWith("tldraw-") ? envLicenseKey : TLDRAW_TRIAL_LICENSE_KEY;

// tldraw only appears here and in lib/lg-actions.ts, which keeps a library switch contained.
// Each chat saves its own board in the browser, under its own key.
export default function LgBoard({ boardId }: { boardId: string }) {
  return (
    <div className="absolute inset-0">
      <Tldraw
        licenseKey={licenseKey}
        components={components}
        shapeUtils={shapeUtils}
        persistenceKey={boardPersistenceKey(boardId)}
        onMount={(editor) => bindLearningGrounds(editor, boardId)}
      />
    </div>
  );
}
