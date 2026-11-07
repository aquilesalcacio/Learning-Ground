"use client";

import { type TLComponents, Tldraw } from "tldraw";
import "tldraw/tldraw.css";
import { bindLearningGrounds } from "@/lib/lg-actions";

const components: TLComponents = {
  MainMenu: null,
  PageMenu: null,
  HelpMenu: null,
  DebugMenu: null,
  DebugPanel: null,
  SharePanel: null,
  // The MVP customizes background and pen color only, from the side panel (vision doc, section 4.1).
  StylePanel: null,
};

// tldraw only appears here and in lib/lg-actions.ts, which keeps a library switch contained.
export default function LgBoard({ filename }: { filename: string | null }) {
  return (
    <div className="absolute inset-0">
      <Tldraw components={components} onMount={(editor) => bindLearningGrounds(editor, filename)} />
    </div>
  );
}
