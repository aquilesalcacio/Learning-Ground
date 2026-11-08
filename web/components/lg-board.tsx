"use client";

import { type TLAnyShapeUtilConstructor, type TLComponents, Tldraw, type TLStateNodeConstructor } from "tldraw";
import "tldraw/tldraw.css";
import { LgMathShapeUtil } from "@/components/lg-math-shape";
import { TutorCursor } from "@/components/tutor-cursor";
import { bindLearningGrounds } from "@/lib/lg-actions";
import { LgPointTool } from "@/lib/lg-point-tool";
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

// The student's Show the tutor tool, alongside tldraw's own. Defined once, so the editor isn't
// recreated on each render.
const tools: TLStateNodeConstructor[] = [LgPointTool];

// tldraw needs a license key on any domain but localhost. It's public by design: tldraw ties it to
// our domain. Without it, a deployed board shows tldraw's licence notice.
const licenseKey = process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY || undefined;

// tldraw only appears here and in lib/lg-actions.ts and lib/lg-point-tool.ts (the back end's
// lib/lg-board-link.ts aside), which keeps a library switch contained.
// Each chat saves its own board in the browser, under its own key.
export default function LgBoard({ boardId }: { boardId: string }) {
  return (
    <div className="absolute inset-0">
      <Tldraw
        licenseKey={licenseKey}
        components={components}
        shapeUtils={shapeUtils}
        tools={tools}
        persistenceKey={boardPersistenceKey(boardId)}
        onMount={(editor) => bindLearningGrounds(editor, boardId)}
      />
    </div>
  );
}
