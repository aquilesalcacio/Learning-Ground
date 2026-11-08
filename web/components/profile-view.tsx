"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FieldSelect } from "@/components/lg-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  type CanvasLmsLaunch,
  type CanvasLmsStatus,
  addCanvasLmsCalendarFeed,
  canvasLmsStatus,
  claimCanvasLmsLaunch,
  connectCanvasLms,
  disconnectCanvasLms,
  importCanvasLmsProfile,
  refreshCanvasLmsCalendarFeed,
  removeCanvasLmsCalendarFeed,
} from "@/lib/lg-canvas-lms";
import { updateProfile, useLgState } from "@/lib/lg-store";
import { LANGUAGE_OPTIONS } from "@/lib/lg-types";

const RETURN_MESSAGES: Record<string, string> = {
  denied: "Canvas LMS access wasn't allowed, so nothing was imported.",
  error: "Connecting Canvas LMS didn't work. Please try again.",
};

function importedMessage() {
  const time = new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `Imported from Canvas LMS at ${time}.`;
}

function launchMessage(launch: CanvasLmsLaunch) {
  const course = [launch.course, launch.course_code && `(${launch.course_code})`].filter(Boolean).join(" ");
  const parts = [launch.name && `Signed in to Canvas LMS as ${launch.name}`, course && `opened from ${course}`];
  const opened = parts.filter(Boolean).join(", ") || "Opened from Canvas LMS";
  return launch.assignment_title ? `${opened}, for "${launch.assignment_title}".` : `${opened}.`;
}

function feedMessage(count: number) {
  return `Calendar feed imported: ${count} ${count === 1 ? "event" : "events"} read. ${importedMessage()}`;
}

function CanvasLmsCard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Read once: the query is dropped right away so a reload doesn't import again.
  const [returned] = useState(() => searchParams.get("canvas_lms"));
  const [launchCode] = useState(() => searchParams.get("canvas_lms_launch"));
  const [status, setStatus] = useState<CanvasLmsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedUrl, setFeedUrl] = useState("");
  const [message, setMessage] = useState(
    launchCode
      ? "Reading what Canvas LMS sent…"
      : returned === "connected"
        ? "Importing from Canvas LMS…"
        : (RETURN_MESSAGES[returned ?? ""] ?? ""),
  );
  const started = useRef(false);

  const showStatus = useCallback((result: Awaited<ReturnType<typeof canvasLmsStatus>>) => {
    if (result.ok) setStatus(result.value);
    else setMessage(result.message);
  }, []);

  const showImport = useCallback((result: Awaited<ReturnType<typeof importCanvasLmsProfile>>) => {
    setMessage(result.ok ? importedMessage() : result.message);
  }, []);

  const showLaunch = useCallback((result: Awaited<ReturnType<typeof claimCanvasLmsLaunch>>) => {
    setMessage(result.ok ? launchMessage(result.value) : result.message);
  }, []);

  useEffect(() => {
    if (started.current) return; // Strict Mode runs effects twice in development.
    started.current = true;
    if (returned || launchCode) router.replace("/profile");
    // Opened from a Canvas LMS course, or back from Canvas LMS OAuth: import straight away.
    const first = launchCode
      ? claimCanvasLmsLaunch(launchCode).then(showLaunch)
      : returned === "connected"
        ? importCanvasLmsProfile().then(showImport)
        : Promise.resolve();
    void first.then(canvasLmsStatus).then(showStatus);
  }, [returned, launchCode, router, showImport, showLaunch, showStatus]);

  async function run(work: () => Promise<string>) {
    setBusy(true);
    setMessage(await work());
    showStatus(await canvasLmsStatus());
    setBusy(false);
  }

  const addFeed = () =>
    run(async () => {
      const result = await addCanvasLmsCalendarFeed(feedUrl);
      if (result.ok) setFeedUrl("");
      return result.ok ? feedMessage(result.value.event_count) : result.message;
    });

  const refreshFeed = () =>
    run(async () => {
      const result = await refreshCanvasLmsCalendarFeed();
      return result.ok ? feedMessage(result.value.event_count) : result.message;
    });

  const removeFeed = () =>
    run(async () => {
      const result = await removeCanvasLmsCalendarFeed();
      return result.ok ? "Calendar feed removed. Your profile keeps what was imported." : result.message;
    });

  const runImport = () =>
    run(async () => {
      const result = await importCanvasLmsProfile();
      return result.ok ? importedMessage() : result.message;
    });

  async function connect() {
    setBusy(true);
    const result = await connectCanvasLms();
    // On success the browser is already leaving for Canvas LMS.
    if (result && !result.ok) {
      setBusy(false);
      setMessage(result.message);
    }
  }

  const disconnect = () =>
    run(async () => {
      const result = await disconnectCanvasLms();
      return result.ok ? "Canvas LMS is disconnected. Your profile keeps what was imported." : result.message;
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Canvas LMS</CardTitle>
        <CardDescription>
          Bring in your real courses and due dates. You stay signed in on Canvas LMS; we never see your password.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {status?.lti_ready && (
          <div className="grid gap-1">
            <p className="text-sm font-medium">Open from your course</p>
            <p className="text-sm text-muted-foreground">
              In your Canvas LMS course, click <span className="font-medium">Learning Grounds</span> in the course menu, or
              open it from an assignment. Canvas LMS sends your name, course and that assignment&apos;s due date here.
            </p>
          </div>
        )}

        <div className="grid gap-2">
          <Label htmlFor="canvas-lms-feed">Calendar feed</Label>
          {status?.calendar_feed ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={refreshFeed} disabled={busy}>
                {busy ? "Working…" : "Refresh due dates"}
              </Button>
              <Button type="button" variant="outline" onClick={removeFeed} disabled={busy}>
                Remove feed
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="canvas-lms-feed"
                  className="min-w-0 flex-1"
                  inputMode="url"
                  placeholder="https://canvaslite.instructure.com/feeds/calendars/user_….ics"
                  value={feedUrl}
                  onChange={(event) => setFeedUrl(event.target.value)}
                />
                <Button type="button" onClick={addFeed} disabled={busy || !feedUrl.trim() || status === null}>
                  {busy ? "Working…" : "Import"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                In Canvas LMS, open Calendar, click Calendar Feed and copy the link. It fills Courses and Coming up.
              </p>
            </>
          )}
        </div>

        {status?.oauth_available && (
          <div className="flex flex-wrap gap-2">
            {status.connected ? (
              <>
                <Button type="button" onClick={runImport} disabled={busy}>
                  Import from {status.canvas_lms_user || "Canvas LMS"}
                </Button>
                <Button type="button" variant="outline" onClick={disconnect} disabled={busy}>
                  Disconnect
                </Button>
              </>
            ) : (
              <Button type="button" variant="outline" onClick={connect} disabled={busy}>
                Connect your school&apos;s Canvas LMS
              </Button>
            )}
          </div>
        )}

        {message && (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function ProfileView() {
  const { profile } = useLgState();

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6 p-4 sm:p-8">
      <div>
        <h1 className="text-2xl font-semibold">Student Profile</h1>
        <p className="text-sm text-muted-foreground">
          Your tutor reads this at the start of a session. Changes save automatically in this browser.
        </p>
      </div>

      <CanvasLmsCard />

      <Card>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="profile-name">Name</Label>
            <Input
              id="profile-name"
              placeholder="Your name"
              value={profile.name}
              onChange={(event) => updateProfile({ name: event.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="profile-school">School</Label>
            <Input
              id="profile-school"
              placeholder="Your school"
              value={profile.school}
              onChange={(event) => updateProfile({ school: event.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="profile-courses">Courses</Label>
            <Textarea
              id="profile-courses"
              rows={3}
              placeholder="One course per line"
              value={profile.courses}
              onChange={(event) => updateProfile({ courses: event.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="profile-upcoming">Coming up</Label>
            <Textarea
              id="profile-upcoming"
              rows={3}
              placeholder="Assignments and due dates. Connect Canvas LMS to fill this in."
              value={profile.upcoming}
              onChange={(event) => updateProfile({ upcoming: event.target.value })}
            />
          </div>
          <FieldSelect
            id="profile-language"
            label="Preferred language"
            value={profile.language}
            options={LANGUAGE_OPTIONS}
            placeholder="Choose a language"
            onChange={(language) => updateProfile({ language })}
          />
          <div className="grid gap-2">
            <Label htmlFor="profile-struggles">What&apos;s hard for you</Label>
            <Textarea
              id="profile-struggles"
              rows={4}
              placeholder="Topics or habits you want help with"
              value={profile.struggles}
              onChange={(event) => updateProfile({ struggles: event.target.value })}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
