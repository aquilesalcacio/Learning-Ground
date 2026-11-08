"""Canvas LMS calendar feed import: courses and due dates from a student's own .ics feed.

Every Canvas LMS user, Canvas Lite included, has a Calendar Feed link (Calendar > Calendar Feed) meant
for calendar apps. The student pastes it here; we fetch it on demand and keep only the URL, under
their Auth0 user ID, so Refresh works. Only Canvas LMS feed URLs are fetched, without redirects.
"""
import os
import re
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import httpx
from pydantic import BaseModel

import canvas_lms

FEED_PATH = re.compile(r"^/feeds/calendars/user_[A-Za-z0-9]{10,80}\.ics$")
MAX_FEED_BYTES = 2 * 1024 * 1024
WINDOW_DAYS = 30
MAX_COURSES = 12
# Canvas LMS ends each event title with its course: "Lab report [Biology 101]".
COURSE_SUFFIX = re.compile(r"^(?P<title>.*?)\s*\[(?P<course>[^\[\]]+)\]\s*$")

_transport: httpx.AsyncBaseTransport | None = None  # Tests swap in a MockTransport.


class CalendarFeedError(Exception):
    """The feed couldn't be used. The message is safe to show the student."""


class CalendarFeedImport(BaseModel):
    courses: list[str]
    upcoming: str
    event_count: int


def _allowed_hosts() -> tuple[str, ...]:
    extra = os.environ.get("CANVAS_LMS_FEED_HOSTS", "")
    return tuple(h.strip().lower() for h in extra.split(",") if h.strip())


def check_url(url: str) -> str:
    """Returns the URL if it's a Canvas LMS user calendar feed, else raises CalendarFeedError."""
    url = url.strip()
    if url.startswith("webcal://"):
        url = "https://" + url.removeprefix("webcal://")
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    canvas_host = host.endswith(".instructure.com") or host in _allowed_hosts()
    if parts.scheme != "https" or not canvas_host or parts.port not in (None, 443) or parts.username:
        raise CalendarFeedError("That isn't a Canvas LMS calendar feed link. Copy it from Calendar > Calendar Feed.")
    if not FEED_PATH.match(parts.path) or parts.query or parts.fragment:
        raise CalendarFeedError("That isn't a Canvas LMS calendar feed link. Copy it from Calendar > Calendar Feed.")
    return f"https://{host}{parts.path}"


# --- .ics parsing --------------------------------------------------------------------------------


def _unfold(text: str) -> list[str]:
    lines: list[str] = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw[:1] in (" ", "\t") and lines:
            lines[-1] += raw[1:]
        elif raw:
            lines.append(raw)
    return lines


def _unescape(value: str) -> str:
    return value.replace("\\n", " ").replace("\\N", " ").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")


def _parse_start(value: str, params: dict[str, str], tz: ZoneInfo) -> tuple[datetime, bool] | None:
    try:
        if params.get("VALUE") == "DATE" or re.fullmatch(r"\d{8}", value):
            day = datetime.strptime(value[:8], "%Y%m%d")
            return day.replace(tzinfo=tz), True
        if value.endswith("Z"):
            return datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=ZoneInfo("UTC")).astimezone(tz), False
        local = datetime.strptime(value, "%Y%m%dT%H%M%S")
        zone = ZoneInfo(params["TZID"]) if "TZID" in params else tz
        return local.replace(tzinfo=zone).astimezone(tz), False
    except (ValueError, KeyError):
        return None


def parse_events(text: str, tz: ZoneInfo) -> list[tuple[datetime, bool, str, str]]:
    """(start, all_day, title, course) for each VEVENT that has a start and a title."""
    events, current = [], None
    for line in _unfold(text):
        if line == "BEGIN:VEVENT":
            current = {}
        elif line == "END:VEVENT":
            if current and "start" in current and current.get("summary"):
                start, all_day = current["start"]
                match = COURSE_SUFFIX.match(current["summary"])
                title, course = (match["title"], match["course"].strip()) if match else (current["summary"], "")
                events.append((start, all_day, title.strip()[:150], course[:100]))
            current = None
        elif current is not None and ":" in line:
            head, value = line.split(":", 1)
            name, *raw_params = head.split(";")
            params = dict(p.split("=", 1) for p in raw_params if "=" in p)
            if name.upper() == "SUMMARY":
                current["summary"] = _unescape(value).strip()
            elif name.upper() == "DTSTART" and (start := _parse_start(value.strip(), params, tz)):
                current["start"] = start
    return events


def summarize(events: list[tuple[datetime, bool, str, str]], now: datetime) -> CalendarFeedImport:
    courses: list[str] = []
    for _, _, _, course in sorted(events, key=lambda e: e[0]):
        if course and course not in courses:
            courses.append(course)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    soon = [
        e
        for e in events
        if (e[0] >= today if e[1] else e[0] >= now) and e[0] <= now + timedelta(days=WINDOW_DAYS)
    ]
    soon.sort(key=lambda e: e[0])
    lines = [canvas_lms.upcoming_line(course, title, start, all_day) for start, all_day, title, course in soon]
    return CalendarFeedImport(
        courses=courses[:MAX_COURSES],
        upcoming="\n".join(lines[: canvas_lms.MAX_UPCOMING]),
        event_count=len(events),
    )


async def fetch(url: str, now: datetime | None = None) -> CalendarFeedImport:
    url = check_url(url)
    tz = canvas_lms.timezone()
    try:
        async with httpx.AsyncClient(
            headers={"User-Agent": canvas_lms.USER_AGENT}, timeout=15.0, follow_redirects=False, transport=_transport
        ) as client:
            async with client.stream("GET", url) as response:
                if response.status_code == 404:
                    raise CalendarFeedError("Canvas LMS didn't find that feed. Copy the link again from Calendar Feed.")
                if response.status_code != 200:
                    raise CalendarFeedError("Canvas LMS didn't send the calendar. Please try again.")
                body = b""
                async for chunk in response.aiter_bytes():
                    body += chunk
                    if len(body) > MAX_FEED_BYTES:
                        raise CalendarFeedError("That calendar is too large to import.")
    except httpx.HTTPError as error:
        raise CalendarFeedError("We couldn't reach Canvas LMS. Please try again.") from error
    text = body.decode("utf-8", errors="replace")
    if "BEGIN:VCALENDAR" not in text:
        raise CalendarFeedError("That link didn't return a calendar.")
    return summarize(parse_events(text, tz), now or datetime.now(tz))


# --- saved feed per student -------------------------------------------------------------------------


def _db() -> sqlite3.Connection:
    conn = canvas_lms._db()
    conn.execute("CREATE TABLE IF NOT EXISTS canvas_lms_feeds (sub TEXT PRIMARY KEY, url TEXT NOT NULL)")
    return conn


def save_url(sub: str, url: str) -> None:
    with closing(_db()) as conn, conn:
        conn.execute("INSERT OR REPLACE INTO canvas_lms_feeds VALUES (?, ?)", (sub, url))


def load_url(sub: str) -> str | None:
    with closing(_db()) as conn:
        row = conn.execute("SELECT url FROM canvas_lms_feeds WHERE sub = ?", (sub,)).fetchone()
    return row[0] if row else None


def delete_url(sub: str) -> None:
    with closing(_db()) as conn, conn:
        conn.execute("DELETE FROM canvas_lms_feeds WHERE sub = ?", (sub,))
