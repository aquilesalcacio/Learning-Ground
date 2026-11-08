"use client";

import { type TLComponents, Tldraw } from "tldraw";
import "tldraw/tldraw.css";
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
};

// tldraw only appears here and in lib/lg-actions.ts, which keeps a library switch contained.
// Each chat saves its own board in the browser, under its own key.
export default function LgBoard({ boardId }: { boardId: string }) {
  return (
    <div className="absolute inset-0">
      <Tldraw
        components={components}
        persistenceKey={boardPersistenceKey(boardId)}
        onMount={(editor) => bindLearningGrounds(editor, boardId)}
      />
    </div>
  );
}
