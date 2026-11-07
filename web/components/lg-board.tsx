"use client";

import { type TLComponents, Tldraw } from "tldraw";
import "tldraw/tldraw.css";
import { bindLearningGrounds } from "@/lib/lg-actions";

// Every piece of tldraw's own chrome is off. The chat dock's pencil menu is the
// only toolbar, which is what leaves the page itself uncluttered.
const components: TLComponents = {
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
export default function LgBoard({ filename }: { filename: string | null }) {
  return (
    <div className="absolute inset-0">
      <Tldraw components={components} onMount={(editor) => bindLearningGrounds(editor, filename)} />
    </div>
  );
}
