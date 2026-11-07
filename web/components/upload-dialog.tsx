"use client";

import { Paperclip, Upload } from "lucide-react";
import { type ChangeEvent, type DragEvent, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  getIdleLgUpload,
  getLgUpload,
  removeLgDocument,
  retryLgReading,
  subscribeLgUpload,
  uploadLgHomework,
} from "@/lib/lg-actions";
import { MAX_FILE_BYTES, MAX_PAGES } from "@/lib/lg-document";
import { getActiveDocument, useLgState } from "@/lib/lg-store";

const ACCEPT = "application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp";

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function unreadPages(numbers: number[], total: number) {
  const which =
    numbers.length === total
      ? total === 1
        ? "The page wasn't"
        : "The pages weren't"
      : numbers.length === 1
        ? `Page ${numbers[0]} wasn't`
        : `Pages ${numbers.join(", ")} weren't`;
  return `${which} read, so the tutor can only point at the whole page there.`;
}

// The upload button on the chat bar. The pages open on the board behind this popup first,
// then Gemini reads them one at a time, so the student never has to leave the board.
export function UploadDialog() {
  const state = useLgState();
  const document = getActiveDocument(state);
  const upload = useSyncExternalStore(subscribeLgUpload, getLgUpload, getIdleLgUpload);
  // Progress and errors belong to the chat they started in, or to the start screen. An upload
  // there is tagged with the draft board's ID until it begins the chat.
  const boardId = state.active_conversation_id ?? state.draft_id;
  const mine = upload.conversation_id === null || upload.conversation_id === boardId;
  const opening = mine && upload.busy === "opening";
  const reading = mine && upload.busy === "reading";
  const error = mine ? upload.error : "";

  const failedPages = document?.pages.filter((page) => page.read === "failed") ?? [];
  const problems = document?.regions.filter((item) => !item.region_id.endsWith(".page")).length ?? 0;

  function choose(file: File | undefined) {
    if (file && !opening) void uploadLgHomework(file);
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    choose(file);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    choose(event.dataTransfer.files[0]);
  }

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Upload homework"
            title="Upload homework"
            className="shrink-0 rounded-full"
          >
            <Paperclip />
          </Button>
        }
      />
      <DialogContent>
        <div className="grid gap-1">
          <DialogTitle>Upload homework</DialogTitle>
          <DialogDescription>
            A PDF or a photo, up to {MAX_PAGES} pages and {MAX_FILE_BYTES / (1024 * 1024)} MB. It opens on the board
            behind this popup.
          </DialogDescription>
        </div>

        <label
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDrop}
          aria-disabled={opening}
          className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center focus-within:ring-2 focus-within:ring-ring aria-disabled:cursor-wait aria-disabled:opacity-60"
        >
          <Upload aria-hidden="true" className="size-5 text-muted-foreground" />
          <span className="font-medium">Choose a PDF or photo</span>
          <span className="text-xs text-muted-foreground">or drop one on this box</span>
          <input type="file" accept={ACCEPT} className="sr-only" disabled={opening} onChange={onFile} />
        </label>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {opening && (
          <p role="status" className="text-sm text-muted-foreground">
            Opening {upload.filename}...
          </p>
        )}
        {document && !opening && (
          <div className="grid gap-1 rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium break-all">{document.filename}</span>
              <Button type="button" variant="ghost" size="sm" onClick={removeLgDocument}>
                Remove
              </Button>
            </div>
            {reading ? (
              <p role="status" className="text-xs text-muted-foreground">
                Reading your homework
                {upload.total > 1 && upload.page > 0 ? `, page ${upload.page} of ${upload.total}` : ""}... You can start
                working on the board meanwhile.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {plural(problems, "problem")} found across {plural(document.page_count, "page")}.
              </p>
            )}
            {!reading && failedPages.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {unreadPages(failedPages.map((page) => page.number), document.page_count)}
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => void retryLgReading()}>
                  Read again
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <DialogClose
            render={
              <Button type="button" variant="outline">
                Done
              </Button>
            }
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
