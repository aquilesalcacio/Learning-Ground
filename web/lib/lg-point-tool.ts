"use client";

import { StateNode, type TLShapeId } from "tldraw";
import { inkLgSelection, recordLgSelection, removeLgSelectionInk } from "./lg-actions";
import { type SelectionPoint, selectionStroke } from "./lg-selection";

// "Show the tutor": the student taps to point at something on the board, or drags a loop round
// it, such as a line of their own working or part of the printed problem. A tap leaves a small
// ring, a drag a loop that closes itself (lg-selection.ts works out both). lg-actions.ts saves
// the spot as s1, s2... and tells the chat dock, which tells the tutor.
// Registered on <Tldraw> in components/lg-board.tsx, and offered in the pencil menu.

class Idle extends StateNode {
  static override id = "idle";

  override onEnter() {
    this.editor.setCursor({ type: "cross", rotation: 0 });
  }

  override onPointerDown() {
    this.parent.transition("circling");
  }

  override onCancel() {
    this.editor.setCurrentTool("draw");
  }
}

class Circling extends StateNode {
  static override id = "circling";

  private points: SelectionPoint[] = [];
  private shapeId: TLShapeId | null = null;

  override onEnter() {
    const { x, y } = this.editor.inputs.getCurrentPagePoint();
    this.points = [{ x, y }];
    this.shapeId = null;
  }

  override onPointerMove() {
    const { x, y } = this.editor.inputs.getCurrentPagePoint();
    const last = this.points[this.points.length - 1];
    // Under a pixel apart adds nothing but points to redraw.
    if (Math.hypot(x - last.x, y - last.y) * this.editor.getZoomLevel() < 1) return;
    this.points.push({ x, y });
    // The loop shows once the pointer has really moved, so a tap never flickers one.
    if (this.shapeId || this.editor.inputs.getIsDragging()) {
      this.shapeId = inkLgSelection(this.editor, this.shapeId, this.points, false);
    }
  }

  override onPointerUp() {
    this.complete();
  }

  override onComplete() {
    this.complete();
  }

  override onCancel() {
    this.cancel();
  }

  override onInterrupt() {
    if (!this.editor.inputs.getIsDragging()) this.cancel();
  }

  // Switching tools mid-loop leaves nothing half drawn.
  override onExit() {
    if (this.shapeId) removeLgSelectionInk(this.editor, this.shapeId);
    this.shapeId = null;
    this.points = [];
  }

  private complete() {
    const stroke = selectionStroke(this.points, this.editor.getZoomLevel());
    if (stroke) {
      const id = inkLgSelection(this.editor, this.shapeId, stroke.points, true);
      // Recorded, the loop is the board's to keep, so leaving this state must not remove it.
      this.shapeId = null;
      recordLgSelection(this.editor, id, stroke.bounds);
    }
    this.parent.transition("idle");
  }

  private cancel() {
    this.parent.transition("idle");
  }
}

export class LgPointTool extends StateNode {
  static override id = "lg-point";
  static override initial = "idle";
  static override isLockable = false;
  static override children() {
    return [Idle, Circling];
  }
}
