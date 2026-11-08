"""Turn in to Canvas LMS: a Learning Grounds session sent back as the student's submission, with a score.

LTI 1.1 Basic Outcomes. When a student opens a graded assignment that uses Learning Grounds, Canvas
LMS sends lis_outcome_service_url and lis_result_sourcedid. We keep them under the student's Auth0
user ID (canvas_lms_lti.claim). When the student confirms Turn in, we send a signed replaceResult
with a completion score and a summary that says plainly it came from Learning Grounds.

The score is decided here, never by the browser: full points for completion, with Canvas LMS told
to keep any grade the teacher gives (prioritizeNonToolGrade).
"""
import base64
import hashlib
import logging
import re
import secrets
import time
import uuid
from contextlib import closing
from datetime import datetime
from html import escape
from typing import Literal
from urllib.parse import parse_qsl, urlsplit

import httpx
from pydantic import BaseModel, Field

import canvas_lms
import canvas_lms_feed
import canvas_lms_lti
from canvas_lms_lti import CanvasLmsLaunch, Outcome, _enc, signature

log = logging.getLogger("learning_grounds.canvas_lms_grades")

COMPLETION_SCORE = "1.0"
_transport: httpx.AsyncBaseTransport | None = None  # Tests swap in a MockTransport.


class TurnInError(Exception):
    """The turn-in didn't happen. The message is safe to show the student."""


class WorkCheck(BaseModel):
    label: str = Field(max_length=80)
    status: Literal["correct", "incomplete", "error", "blank", "unreadable"]


class TurnInSummary(BaseModel):
    """What the browser knows about the session. Everything is shown to the student before sending."""

    turn_in_id: str = Field(max_length=100)
    tutor_name: str = Field("", max_length=60)
    started_at: int = Field(0, ge=0)  # Milliseconds since 1970, from the chat.
    minutes: int = Field(0, ge=0, le=24 * 60)
    student_messages: int = Field(0, ge=0, le=10_000)
    tutor_messages: int = Field(0, ge=0, le=10_000)
    checks: list[WorkCheck] = Field(default_factory=list, max_length=30)
    note: str = Field("", max_length=600)


class TurnInResult(BaseModel):
    turned_in_at: str
    score: str
    preview_html: str


# --- storage -------------------------------------------------------------------------------------


def _db():
    conn = canvas_lms._db()
    conn.execute(
        "CREATE TABLE IF NOT EXISTS canvas_lms_turn_ins ("
        " turn_in_id TEXT PRIMARY KEY, sub TEXT NOT NULL, service_url TEXT NOT NULL, sourcedid TEXT NOT NULL,"
        " title TEXT NOT NULL, created_at REAL NOT NULL, turned_in_at REAL)"
    )
    return conn


def _allowed(url: str) -> bool:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and (host.endswith(".instructure.com") or host in canvas_lms_feed._allowed_hosts())


def save_turn_in(sub: str, outcome: Outcome, launch: CanvasLmsLaunch) -> str:
    if not _allowed(outcome.service_url):
        log.warning("ignored a grade-back address outside Canvas LMS: %s", urlsplit(outcome.service_url).hostname)
        return ""
    turn_in_id = secrets.token_urlsafe(18)
    with closing(_db()) as conn, conn:
        conn.execute(
            "INSERT INTO canvas_lms_turn_ins VALUES (?, ?, ?, ?, ?, ?, NULL)",
            (turn_in_id, sub, outcome.service_url, outcome.sourcedid, launch.assignment_title, time.time()),
        )
    return turn_in_id


def _load(sub: str, turn_in_id: str) -> tuple[str, str, str] | None:
    with closing(_db()) as conn:
        row = conn.execute(
            "SELECT service_url, sourcedid, title FROM canvas_lms_turn_ins WHERE turn_in_id = ? AND sub = ?",
            (turn_in_id, sub),
        ).fetchone()
    return row


def _mark_turned_in(turn_in_id: str) -> None:
    with closing(_db()) as conn, conn:
        conn.execute("UPDATE canvas_lms_turn_ins SET turned_in_at = ? WHERE turn_in_id = ?", (time.time(), turn_in_id))


# --- the submission ------------------------------------------------------------------------------

STATUS_WORDS = {
    "correct": "correct",
    "incomplete": "on the way, not finished",
    "error": "has a mistake to fix",
    "blank": "nothing written yet",
    "unreadable": "couldn't be read",
}


def summary_html(title: str, summary: TurnInSummary) -> str:
    """The text the teacher sees in SpeedGrader. It always says it came from Learning Grounds."""
    tz = canvas_lms.timezone()
    facts = [f"<li>Assignment: {escape(title)}</li>"] if title else []
    if summary.tutor_name:
        facts.append(f"<li>Tutor: {escape(summary.tutor_name)} (AI)</li>")
    if summary.started_at:
        started = datetime.fromtimestamp(summary.started_at / 1000, tz)
        when = f"{started:%b} {started.day}, {started:%I:%M %p}".replace(" 0", " ")
        length = f", about {summary.minutes} min" if summary.minutes else ""
        facts.append(f"<li>Session: {when}{length}</li>")
    facts.append(f"<li>Messages: {summary.student_messages} from the student, {summary.tutor_messages} from the tutor</li>")
    parts = [
        "<p><strong>✏️ Submitted with Learning Grounds</strong></p>",
        "<p>The student turned this in from a tutoring session in Learning Grounds, an AI voice tutor that works "
        "through homework on a shared whiteboard.</p>",
        f"<ul>{''.join(facts)}</ul>",
    ]
    if summary.checks:
        checks = "".join(
            f"<li>{escape(check.label)}: {STATUS_WORDS[check.status]}</li>" for check in summary.checks
        )
        parts.append(f"<p><strong>Work checked during the session</strong></p><ul>{checks}</ul>")
    if summary.note.strip():
        parts.append(f"<p><strong>Student's note</strong></p><p>{escape(summary.note.strip())}</p>")
    parts.append(
        "<p><em>Score: full points for completing a Learning Grounds session. It isn't a judgment of correctness, "
        "and any grade you give replaces it.</em></p>"
    )
    return "".join(parts)


def replace_result_xml(sourcedid: str, score: str, html: str, submitted_at: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<imsx_POXEnvelopeRequest xmlns="http://www.imsglobal.org/services/ltiv1p1/xsd/imsoms_v1p0">
  <imsx_POXHeader>
    <imsx_POXRequestHeaderInfo>
      <imsx_version>V1.0</imsx_version>
      <imsx_messageIdentifier>{uuid.uuid4()}</imsx_messageIdentifier>
    </imsx_POXRequestHeaderInfo>
  </imsx_POXHeader>
  <imsx_POXBody>
    <replaceResultRequest>
      <submissionDetails>
        <submittedAt>{escape(submitted_at)}</submittedAt>
        <prioritizeNonToolGrade/>
      </submissionDetails>
      <resultRecord>
        <sourcedGUID>
          <sourcedId>{escape(sourcedid)}</sourcedId>
        </sourcedGUID>
        <result>
          <resultScore>
            <language>en</language>
            <textString>{score}</textString>
          </resultScore>
          <resultData>
            <text>{escape(html)}</text>
          </resultData>
        </result>
      </resultRecord>
    </replaceResultRequest>
  </imsx_POXBody>
</imsx_POXEnvelopeRequest>
"""


def authorization_header(url: str, body: bytes, key: str, secret: str, now: float | None = None) -> str:
    """OAuth 1.0a with a body hash, as LTI 1.1 Basic Outcomes requires."""
    params = {
        "oauth_consumer_key": key,
        "oauth_nonce": secrets.token_hex(16),
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": str(int(time.time() if now is None else now)),
        "oauth_version": "1.0",
        "oauth_body_hash": base64.b64encode(hashlib.sha1(body).digest()).decode(),
    }
    query = parse_qsl(urlsplit(url).query, keep_blank_values=True)
    params["oauth_signature"] = signature("POST", url, list(params.items()) + query, secret)
    return "OAuth " + ", ".join(f'{_enc(k)}="{_enc(v)}"' for k, v in params.items())


async def turn_in(sub: str, summary: TurnInSummary) -> TurnInResult:
    row = _load(sub, summary.turn_in_id)
    if not row:
        raise TurnInError("Open this assignment from Canvas LMS again to turn it in.")
    service_url, sourcedid, title = row
    config = canvas_lms_lti.settings()
    html = summary_html(title, summary)
    submitted_at = datetime.now(canvas_lms.timezone()).isoformat(timespec="seconds")
    body = replace_result_xml(sourcedid, COMPLETION_SCORE, html, submitted_at).encode()
    headers = {
        "Content-Type": "application/xml",
        "User-Agent": canvas_lms.USER_AGENT,
        "Authorization": authorization_header(service_url, body, config.consumer_key, config.shared_secret),
    }
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=False, transport=_transport) as client:
            response = await client.post(service_url, content=body, headers=headers)
    except httpx.HTTPError as error:
        raise TurnInError("We couldn't reach Canvas LMS. Please try again.") from error
    major = re.search(r"<imsx_codeMajor>\s*(\w+)\s*</imsx_codeMajor>", response.text)
    if response.status_code != 200 or not major or major.group(1) != "success":
        log.warning("canvas lms refused the turn-in: %s %s", response.status_code, response.text[:300])
        raise TurnInError("Canvas LMS didn't accept the turn-in. The assignment may be closed.")
    _mark_turned_in(summary.turn_in_id)
    return TurnInResult(turned_in_at=submitted_at, score=COMPLETION_SCORE, preview_html=html)
