"""Canvas LMS connection: OAuth2 with a Developer Key, a per-student token store, and the profile import.

Students never paste tokens; that breaks Canvas API policy. Each student authorizes our Developer Key
on their Canvas LMS instance, and this module keeps the resulting tokens on the server, keyed by the
student's Auth0 user ID. Nothing else from Canvas LMS is stored: the profile is fetched on demand and
handed to the browser, which keeps it the way it keeps the manual profile.

Configuration (api/.env): CANVAS_LMS_BASE_URL, CANVAS_LMS_CLIENT_ID, CANVAS_LMS_CLIENT_SECRET,
CANVAS_LMS_REDIRECT_URI, CANVAS_LMS_STATE_SECRET, and optionally CANVAS_LMS_SCOPES, CANVAS_LMS_TIMEZONE,
CANVAS_LMS_DB_PATH.
"""
import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import sqlite3
import time
from collections import Counter
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel

log = logging.getLogger("learning_grounds.canvas_lms")

API_DIR = Path(__file__).resolve().parent
load_dotenv(API_DIR / ".env")

USER_AGENT = "LearningGrounds/0.1 (SharkByte 2026)"  # Canvas LMS rejects API calls without one.
STATE_TTL_SECONDS = 10 * 60
REFRESH_MARGIN_SECONDS = 60
MAX_PAGES = 5
MAX_COURSES = 12
MAX_UPCOMING = 8
# Read-only scopes. They must match the scopes ticked on the Developer Key when it enforces scopes.
DEFAULT_SCOPES = " ".join(
    [
        "url:GET|/api/v1/users/:id",
        "url:GET|/api/v1/courses",
        "url:GET|/api/v1/courses/:course_id/assignments",
    ]
)
# Canvas LMS files teacher-made courses under this sub-account. It's not a school name.
NOT_A_SCHOOL = {"manually-created courses"}
LANGUAGES = ("pt", "es", "en")

# Tests swap in an httpx.MockTransport.
_transport: httpx.AsyncBaseTransport | None = None
# States already used once. In memory is enough: a restart also invalidates nothing worse than 10 minutes.
_used_nonces: dict[str, float] = {}


class CanvasLmsError(Exception):
    """Canvas LMS couldn't do what we asked. The message is safe to show the student."""


class CanvasLmsNotConnected(CanvasLmsError):
    """This student hasn't connected Canvas LMS, or the connection was revoked."""


class CanvasLmsConfigError(CanvasLmsError):
    """The server is missing Canvas LMS settings."""


class CanvasLmsProfile(BaseModel):
    name: str
    school: str
    courses: str
    language: str
    upcoming: str


class CanvasLmsStatus(BaseModel):
    connected: bool
    canvas_lms_user: str = ""
    # Which routes this server can offer: OAuth needs a school's Developer Key, LTI needs a key and
    # secret pasted into a Canvas LMS course, and the calendar feed needs nothing but a saved link.
    oauth_available: bool = False
    lti_ready: bool = False
    calendar_feed: bool = False


@dataclass
class Tokens:
    access_token: str
    refresh_token: str
    expires_at: float
    user_id: str
    user_name: str


# --- configuration ---------------------------------------------------------------------------


def _setting(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise CanvasLmsConfigError(f"Canvas LMS isn't set up on the server: {name} is missing.")
    return value


def base_url() -> str:
    return _setting("CANVAS_LMS_BASE_URL").rstrip("/")


def _scopes() -> str:
    # An empty CANVAS_LMS_SCOPES means the Developer Key doesn't enforce scopes, so send none.
    return os.environ.get("CANVAS_LMS_SCOPES", DEFAULT_SCOPES).strip()


def timezone() -> ZoneInfo:
    return ZoneInfo(os.environ.get("CANVAS_LMS_TIMEZONE", "America/New_York"))


def _db_path() -> Path:
    return Path(os.environ.get("CANVAS_LMS_DB_PATH", API_DIR / "data" / "canvas_lms.sqlite"))


# --- OAuth state -----------------------------------------------------------------------------


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(payload: str) -> str:
    key = _setting("CANVAS_LMS_STATE_SECRET").encode()
    return _b64(hmac.new(key, payload.encode(), hashlib.sha256).digest())


def sign_state(sub: str, now: float | None = None) -> str:
    """A signed, expiring, single-use `state` that carries the student's Auth0 user ID through Canvas LMS."""
    now = time.time() if now is None else now
    payload = _b64(json.dumps({"sub": sub, "nonce": secrets.token_urlsafe(16), "exp": int(now) + STATE_TTL_SECONDS}).encode())
    return f"{payload}.{_sign(payload)}"


def read_state(state: str, now: float | None = None) -> str:
    """Returns the Auth0 user ID from a state made by sign_state, or raises CanvasLmsError."""
    now = time.time() if now is None else now
    payload, _, signature = state.partition(".")
    if not payload or not hmac.compare_digest(signature, _sign(payload)):
        raise CanvasLmsError("That Canvas LMS link isn't valid. Please connect again.")
    try:
        data = json.loads(_unb64(payload))
        sub, nonce, exp = str(data["sub"]), str(data["nonce"]), float(data["exp"])
    except (ValueError, KeyError, TypeError) as error:
        raise CanvasLmsError("That Canvas LMS link isn't valid. Please connect again.") from error
    if exp < now:
        raise CanvasLmsError("That Canvas LMS link expired. Please connect again.")
    for old, expiry in list(_used_nonces.items()):
        if expiry < now:
            del _used_nonces[old]
    if nonce in _used_nonces:
        raise CanvasLmsError("That Canvas LMS link was already used. Please connect again.")
    _used_nonces[nonce] = exp
    return sub


def authorize_url(sub: str) -> str:
    params = {
        "client_id": _setting("CANVAS_LMS_CLIENT_ID"),
        "response_type": "code",
        "redirect_uri": _setting("CANVAS_LMS_REDIRECT_URI"),
        "state": sign_state(sub),
    }
    if scopes := _scopes():
        params["scope"] = scopes
    return f"{base_url()}/login/oauth2/auth?{urlencode(params)}"


# --- token store -----------------------------------------------------------------------------


def _db() -> sqlite3.Connection:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS canvas_lms_tokens ("
        " sub TEXT PRIMARY KEY, access_token TEXT NOT NULL, refresh_token TEXT NOT NULL,"
        " expires_at REAL NOT NULL, user_id TEXT NOT NULL, user_name TEXT NOT NULL)"
    )
    return conn


def save_tokens(sub: str, tokens: Tokens) -> None:
    with closing(_db()) as conn, conn:
        conn.execute(
            "INSERT OR REPLACE INTO canvas_lms_tokens VALUES (?, ?, ?, ?, ?, ?)",
            (sub, tokens.access_token, tokens.refresh_token, tokens.expires_at, tokens.user_id, tokens.user_name),
        )


def load_tokens(sub: str) -> Tokens | None:
    with closing(_db()) as conn:
        row = conn.execute(
            "SELECT access_token, refresh_token, expires_at, user_id, user_name FROM canvas_lms_tokens WHERE sub = ?",
            (sub,),
        ).fetchone()
    return Tokens(*row) if row else None


def delete_tokens(sub: str) -> None:
    with closing(_db()) as conn, conn:
        conn.execute("DELETE FROM canvas_lms_tokens WHERE sub = ?", (sub,))


# --- HTTP ------------------------------------------------------------------------------------


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=base_url(), headers={"User-Agent": USER_AGENT}, timeout=15.0, transport=_transport
    )


async def _token_request(form: dict[str, str]) -> dict:
    form = {"client_id": _setting("CANVAS_LMS_CLIENT_ID"), "client_secret": _setting("CANVAS_LMS_CLIENT_SECRET"), **form}
    try:
        async with _client() as client:
            response = await client.post("/login/oauth2/token", data=form)
    except httpx.HTTPError as error:
        log.warning("canvas lms token request failed: %s", type(error).__name__)
        raise CanvasLmsError("We couldn't reach Canvas LMS. Please try again.") from error
    if response.status_code in (400, 401):
        # invalid_grant and friends: the code or refresh token is no good any more.
        log.info("canvas lms refused the token request: %s", response.text[:200])
        raise CanvasLmsNotConnected("Canvas LMS didn't accept the connection. Please connect again.")
    if response.status_code != 200:
        raise CanvasLmsError("Canvas LMS had a problem. Please try again.")
    return response.json()


async def exchange_code(sub: str, code: str) -> Tokens:
    data = await _token_request(
        {"grant_type": "authorization_code", "code": code, "redirect_uri": _setting("CANVAS_LMS_REDIRECT_URI")}
    )
    user = data.get("user") or {}
    tokens = Tokens(
        access_token=data["access_token"],
        refresh_token=data.get("refresh_token", ""),
        expires_at=time.time() + float(data.get("expires_in", 3600)),
        user_id=str(user.get("id", "")),
        user_name=str(user.get("name", "")),
    )
    save_tokens(sub, tokens)
    return tokens


async def _refresh(sub: str, tokens: Tokens) -> Tokens:
    if not tokens.refresh_token:
        delete_tokens(sub)
        raise CanvasLmsNotConnected("Your Canvas LMS connection expired. Please connect again.")
    try:
        data = await _token_request({"grant_type": "refresh_token", "refresh_token": tokens.refresh_token})
    except CanvasLmsNotConnected:
        delete_tokens(sub)
        raise
    tokens.access_token = data["access_token"]
    tokens.expires_at = time.time() + float(data.get("expires_in", 3600))
    save_tokens(sub, tokens)
    return tokens


async def _fresh_tokens(sub: str) -> Tokens:
    tokens = load_tokens(sub)
    if not tokens:
        raise CanvasLmsNotConnected("Connect Canvas LMS first.")
    if tokens.expires_at - REFRESH_MARGIN_SECONDS < time.time():
        tokens = await _refresh(sub, tokens)
    return tokens


class _Session:
    """GET calls for one student, refreshing the token once if Canvas LMS says it expired."""

    def __init__(self, sub: str, tokens: Tokens, client: httpx.AsyncClient):
        self.sub, self.tokens, self.client = sub, tokens, client
        self._lock = asyncio.Lock()

    async def _get(self, url: str, params: dict | None) -> httpx.Response:
        token = self.tokens.access_token
        response = await self.client.get(url, params=params, headers={"Authorization": f"Bearer {token}"})
        if response.status_code == 401:
            async with self._lock:
                if self.tokens.access_token == token:  # Nobody refreshed while we waited.
                    self.tokens = await _refresh(self.sub, self.tokens)
            response = await self.client.get(
                url, params=params, headers={"Authorization": f"Bearer {self.tokens.access_token}"}
            )
        if response.status_code == 401:
            delete_tokens(self.sub)
            raise CanvasLmsNotConnected("Canvas LMS revoked the connection. Please connect again.")
        if response.status_code == 403:
            raise CanvasLmsError("Canvas LMS didn't allow that request. Check the Developer Key's scopes.")
        if response.status_code >= 400:
            raise CanvasLmsError("Canvas LMS had a problem. Please try again.")
        return response

    async def get(self, path: str, params: dict | None = None) -> dict:
        return (await self._get(path, params)).json()

    async def get_all(self, path: str, params: dict | None = None) -> list[dict]:
        """Follows Canvas LMS `Link: rel="next"` pagination, up to MAX_PAGES pages."""
        items: list[dict] = []
        url: str | None = path
        for _ in range(MAX_PAGES):
            response = await self._get(url, params)
            items.extend(response.json())
            url = response.links.get("next", {}).get("url")
            params = None  # The next link already carries the query.
            if not url:
                break
        return items


# --- profile ---------------------------------------------------------------------------------


def _language(user: dict) -> str:
    locale = str(user.get("locale") or user.get("effective_locale") or "").lower()
    return next((lang for lang in LANGUAGES if locale.startswith(lang)), "")


def _school(courses: list[dict]) -> str:
    names = Counter(
        name
        for course in courses
        if (name := str((course.get("account") or {}).get("name") or "").strip())
        and name.lower() not in NOT_A_SCHOOL
    )
    return names.most_common(1)[0][0] if names else ""


def _due(due_at: str, tz: ZoneInfo) -> datetime | None:
    try:
        return datetime.fromisoformat(due_at.replace("Z", "+00:00")).astimezone(tz)
    except (AttributeError, ValueError):
        return None


def due_label(due: datetime, all_day: bool = False) -> str:
    """'Tue Nov 10, 9:00 AM', or 'Tue Nov 10' for an all-day date. Shared by every Canvas LMS source."""
    day = f"{due:%a %b} {due.day}"
    return day if all_day else f"{day}, {due:%I:%M %p}".replace(", 0", ", ")


def upcoming_line(course: str, title: str, due: datetime, all_day: bool = False) -> str:
    prefix = f"{course}: " if course else ""
    return f"{prefix}{title} (due {due_label(due, all_day)})"


def _upcoming_lines(assignments: list[tuple[str, dict]], tz: ZoneInfo) -> list[str]:
    dated = [(due, course, a) for course, a in assignments if (due := _due(a.get("due_at") or "", tz))]
    dated.sort(key=lambda item: item[0])
    return [upcoming_line(course, a.get("name", "Assignment"), due) for due, course, a in dated[:MAX_UPCOMING]]


async def fetch_profile(sub: str) -> CanvasLmsProfile:
    tokens = await _fresh_tokens(sub)
    try:
        async with _client() as client:
            session = _Session(sub, tokens, client)
            user = await session.get("/api/v1/users/self")
            courses = await session.get_all(
                "/api/v1/courses",
                {
                    "enrollment_type": "student",
                    "enrollment_state": "active",
                    "include[]": "account",
                    "per_page": "50",
                },
            )
            courses = [c for c in courses if c.get("name") and not c.get("access_restricted_by_date")][:MAX_COURSES]
            per_course = await asyncio.gather(
                *(
                    session.get_all(
                        f"/api/v1/courses/{course['id']}/assignments",
                        {"bucket": "upcoming", "order_by": "due_at", "per_page": "20"},
                    )
                    for course in courses
                )
            )
    except httpx.HTTPError as error:
        log.warning("canvas lms api call failed: %s", type(error).__name__)
        raise CanvasLmsError("We couldn't reach Canvas LMS. Please try again.") from error

    assignments = [(course["name"], a) for course, items in zip(courses, per_course) for a in items]
    return CanvasLmsProfile(
        name=str(user.get("name") or ""),
        school=_school(courses),
        courses="\n".join(course["name"] for course in courses),
        language=_language(user),
        upcoming="\n".join(_upcoming_lines(assignments, timezone())),
    )


OAUTH_SETTINGS = ("CANVAS_LMS_BASE_URL", "CANVAS_LMS_CLIENT_ID", "CANVAS_LMS_CLIENT_SECRET", "CANVAS_LMS_REDIRECT_URI", "CANVAS_LMS_STATE_SECRET")


def oauth_available() -> bool:
    return all(os.environ.get(name, "").strip() for name in OAUTH_SETTINGS)


def status(sub: str) -> CanvasLmsStatus:
    tokens = load_tokens(sub)
    return CanvasLmsStatus(
        connected=bool(tokens), canvas_lms_user=tokens.user_name if tokens else "", oauth_available=oauth_available()
    )


async def disconnect(sub: str) -> None:
    """Revokes the token at Canvas LMS (best effort) and forgets it here."""
    tokens = load_tokens(sub)
    delete_tokens(sub)
    if not tokens:
        return
    try:
        async with _client() as client:
            await client.delete("/login/oauth2/token", headers={"Authorization": f"Bearer {tokens.access_token}"})
    except httpx.HTTPError as error:
        log.info("canvas lms revoke failed, token deleted locally anyway: %s", type(error).__name__)
