"use client";

import katex from "katex";
import "katex/dist/katex.min.css";
import { BaseBoxShapeUtil, HTMLContainer, type RecordProps, T, type TLShape } from "tldraw";
import { COLOR_HEX, type PenColor } from "@/lib/lg-types";

// The tutor's equations on the board (write_math): LaTeX rendered with KaTeX in the tutor's
// colour, revealed left to right while the tutor's pen writes it.
//
// Saved boards hold these shapes, so this util must stay registered on <Tldraw> (lg-board.tsx)
// for as long as such boards may exist, or they won't load.

export const LG_MATH = "lg-math";
const FONT_SIZE = 24;
const PADDING = 6;
export const LG_MATH_MAX = 160;

declare module "tldraw" {
  export interface TLGlobalShapePropsMap {
    [LG_MATH]: { w: number; h: number; latex: string; color: string; reveal: number };
  }
}

export type LgMathShape = TLShape<typeof LG_MATH>;

// Never throws: LaTeX KaTeX can't read is shown as written, in red. \href and other commands
// that could reach outside the board stay off (trust is false by default).
function renderMath(latex: string): string {
  return katex.renderToString(latex.slice(0, LG_MATH_MAX), {
    throwOnError: false,
    displayMode: false,
    output: "html",
    strict: "ignore",
    maxExpand: 200,
    maxSize: 20,
  });
}

// The equation's size on the board, measured off screen, so the shape fits it.
export function measureLgMath(latex: string): { w: number; h: number } {
  const probe = document.createElement("div");
  probe.style.cssText = `position:absolute;left:-10000px;top:0;visibility:hidden;white-space:nowrap;font-size:${FONT_SIZE}px;`;
  probe.innerHTML = renderMath(latex);
  document.body.appendChild(probe);
  const box = probe.getBoundingClientRect();
  probe.remove();
  return { w: Math.ceil(box.width) + PADDING * 2, h: Math.ceil(box.height) + PADDING * 2 };
}

export class LgMathShapeUtil extends BaseBoxShapeUtil<LgMathShape> {
  static override type = LG_MATH;
  static override props: RecordProps<LgMathShape> = {
    w: T.number,
    h: T.number,
    latex: T.string,
    color: T.string,
    reveal: T.number,
  };

  getDefaultProps(): LgMathShape["props"] {
    return { w: 120, h: 40, latex: "", color: "black", reveal: 1 };
  }

  override canEdit() {
    return false;
  }

  override canResize() {
    return false;
  }

  override hideRotateHandle() {
    return true;
  }

  component(shape: LgMathShape) {
    const { latex, color, reveal } = shape.props;
    const hidden = Math.round((1 - Math.min(Math.max(reveal, 0), 1)) * 100);
    return (
      <HTMLContainer
        style={{
          padding: PADDING,
          fontSize: FONT_SIZE,
          lineHeight: 1.2,
          whiteSpace: "nowrap",
          color: COLOR_HEX[color as PenColor] ?? color,
          clipPath: hidden ? `inset(0 ${hidden}% 0 0)` : undefined,
          pointerEvents: "all",
        }}
      >
        <span dangerouslySetInnerHTML={{ __html: renderMath(latex) }} />
      </HTMLContainer>
    );
  }

  // The outline tldraw draws on its canvas when the shape is selected or hovered.
  override getIndicatorPath(shape: LgMathShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}
