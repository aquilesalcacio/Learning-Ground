"use client";

import { Paperclip, Upload } from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { MockBadge } from "@/components/lg-fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LG_PAGES, LG_REGIONS } from "@/lib/lg-regions";
import { setLgDocument, useLgState } from "@/lib/lg-store";

const MOCK_PROCESSING_MS = 1500;

// The upload button on the chat bar. Same mocked PDF flow as Start, in a popup
// so the student never has to leave the board to swap homework.
export function UploadDialog() {
  const state = useLgState();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("That file isn't a PDF. Choose a PDF.");
      return;
    }
    setError("");
    setLgDocument(null);
    setProcessing(true);
    timer.current = setTimeout(() => {
      setLgDocument({ filename: file.name, page_count: LG_PAGES.length, status: "ready" });
      setProcessing(false);
    }, MOCK_PROCESSING_MS);
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
          <DialogTitle className="flex flex-wrap items-center gap-2">
            Upload homework <MockBadge label="Regions mocked" />
          </DialogTitle>
          <DialogDescription>A PDF of up to about 10 pages. It opens on the board behind this popup.</DialogDescription>
        </div>

        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center focus-within:ring-2 focus-within:ring-ring">
          <Upload aria-hidden="true" className="size-5 text-muted-foreground" />
          <span className="font-medium">Choose a PDF</span>
          <span className="text-xs text-muted-foreground">or drop one on this box</span>
          <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={onFile} />
        </label>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {processing && (
          <p role="status" className="text-sm text-muted-foreground">
            Detecting regions...
          </p>
        )}
        {state.document && !processing && (
          <div className="grid gap-1 rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium break-all">{state.document.filename}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setLgDocument(null)}>
                Remove
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {LG_REGIONS.length} placeholder regions across {state.document.page_count} placeholder pages. The PDF
              itself isn&apos;t read yet.
            </p>
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
