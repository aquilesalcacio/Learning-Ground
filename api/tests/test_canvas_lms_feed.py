"""Canvas LMS calendar feed tests. The feed is served by httpx.MockTransport; no network is used."""
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi.testclient import TestClient

import canvas_lms_feed
from canvas_lms_feed import CalendarFeedError, check_url, parse_events, summarize
from main import app

client = TestClient(app)
NY = ZoneInfo("America/New_York")
FEED = "https://canvaslite.instructure.com/feeds/calendars/user_AbCdEf0123456789xyz.ics"
NOW = datetime(2026, 11, 7, 18, 0, tzinfo=NY)

# Shaped like a real Canvas LMS feed: CRLF, a folded line, UTC times, an all-day event, a past event.
ICS = "\r\n".join(
    [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:icalendar-ruby",
        "X-WR-CALNAME:Maria Silva Calendar (Canvas)",
        "BEGIN:VEVENT",
        "DTSTART:20261110T140000Z",
        "SUMMARY:Lab report: cell structure [Biology 101]",
        "UID:event-assignment-1",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "DTSTART:20261113T045900Z",
        "SUMMARY:Quiz: linear equations\\, part 1 [Algebra",
        "  I]",  # Folding adds one space before the original " I]".
        "UID:event-assignment-2",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "DTSTART;VALUE=DATE:20261109",
        "SUMMARY:Reading: photosynthesis notes [Biology 101]",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "DTSTART:20261101T140000Z",
        "SUMMARY:Old worksheet [World History]",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "DTSTART;TZID=America/Chicago:20261120T100000",
        "SUMMARY:Office hours",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "DTSTART:20270301T140000Z",
        "SUMMARY:Far away final [Algebra I]",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
    ]
)


@pytest.fixture
def feed(monkeypatch, tmp_path):
    monkeypatch.setenv("CANVAS_LMS_DB_PATH", str(tmp_path / "canvas_lms.sqlite"))
    requests = []

    def handler(request):
        requests.append(request)
        if request.url.path.endswith("user_AbCdEf0123456789xyz.ics"):
            return httpx.Response(200, text=ICS)
        return httpx.Response(404)

    monkeypatch.setattr(canvas_lms_feed, "_transport", httpx.MockTransport(handler))
    return requests


@pytest.mark.parametrize(
    "url",
    [
        FEED,
        "webcal://canvaslite.instructure.com/feeds/calendars/user_AbCdEf0123456789xyz.ics",
        "  https://school.instructure.com/feeds/calendars/user_AbCdEf0123456789xyz.ics  ",
    ],
)
def test_canvas_lms_feed_urls_are_accepted(url):
    assert check_url(url).startswith("https://")


@pytest.mark.parametrize(
    "url",
    [
        "http://canvaslite.instructure.com/feeds/calendars/user_AbCdEf0123456789xyz.ics",
        "https://evil.com/feeds/calendars/user_AbCdEf0123456789xyz.ics",
        "https://instructure.com.evil.com/feeds/calendars/user_AbCdEf0123456789xyz.ics",
        "https://canvaslite.instructure.com/api/v1/users/self",
        "https://canvaslite.instructure.com/feeds/calendars/user_AbCdEf0123456789xyz.ics?x=1",
        "https://canvaslite.instructure.com:8443/feeds/calendars/user_AbCdEf0123456789xyz.ics",
        "https://me@canvaslite.instructure.com/feeds/calendars/user_AbCdEf0123456789xyz.ics",
        "https://169.254.169.254/feeds/calendars/user_AbCdEf0123456789xyz.ics",
        "file:///etc/passwd",
        "",
    ],
)
def test_other_urls_are_refused(url):
    with pytest.raises(CalendarFeedError):
        check_url(url)


def test_extra_hosts_can_be_allowed(monkeypatch):
    monkeypatch.setenv("CANVAS_LMS_FEED_HOSTS", "canvas.myschool.edu")
    assert check_url("https://canvas.myschool.edu/feeds/calendars/user_AbCdEf0123456789xyz.ics")


def test_parse_and_summarize():
    result = summarize(parse_events(ICS, NY), NOW)
    assert result.courses == ["World History", "Biology 101", "Algebra I"]
    assert result.upcoming.split("\n") == [
        "Biology 101: Reading: photosynthesis notes (due Mon Nov 9)",
        "Biology 101: Lab report: cell structure (due Tue Nov 10, 9:00 AM)",
        "Algebra I: Quiz: linear equations, part 1 (due Thu Nov 12, 11:59 PM)",
        "Office hours (due Fri Nov 20, 11:00 AM)",
    ]
    assert result.event_count == 6


def test_import_saves_the_feed_and_refresh_reuses_it(feed):
    response = client.post("/canvas-lms/calendar-feed", json={"url": FEED})
    assert response.status_code == 200
    assert "Biology 101" in response.json()["courses"]
    assert client.get("/canvas-lms/status").json()["calendar_feed"] is True

    assert client.get("/canvas-lms/calendar-feed").status_code == 200
    assert len(feed) == 2
    assert all(r.headers["User-Agent"].startswith("LearningGrounds/") for r in feed)

    client.post("/canvas-lms/calendar-feed/remove")
    assert client.get("/canvas-lms/status").json()["calendar_feed"] is False
    assert client.get("/canvas-lms/calendar-feed").status_code == 409


def test_bad_url_is_400_and_not_fetched(feed):
    response = client.post("/canvas-lms/calendar-feed", json={"url": "https://evil.com/x.ics"})
    assert response.status_code == 400
    assert feed == []


def test_unknown_feed_is_400(feed):
    url = FEED.replace("AbCdEf0123456789xyz", "Missing0123456789")
    assert client.post("/canvas-lms/calendar-feed", json={"url": url}).status_code == 400


def test_redirects_are_not_followed(monkeypatch, tmp_path):
    monkeypatch.setenv("CANVAS_LMS_DB_PATH", str(tmp_path / "c.sqlite"))
    monkeypatch.setattr(
        canvas_lms_feed,
        "_transport",
        httpx.MockTransport(lambda r: httpx.Response(302, headers={"Location": "http://169.254.169.254/"})),
    )
    assert client.post("/canvas-lms/calendar-feed", json={"url": FEED}).status_code == 400


def test_non_calendar_body_is_refused(monkeypatch, tmp_path):
    monkeypatch.setenv("CANVAS_LMS_DB_PATH", str(tmp_path / "c.sqlite"))
    monkeypatch.setattr(canvas_lms_feed, "_transport", httpx.MockTransport(lambda r: httpx.Response(200, text="<html>")))
    assert client.post("/canvas-lms/calendar-feed", json={"url": FEED}).status_code == 400
