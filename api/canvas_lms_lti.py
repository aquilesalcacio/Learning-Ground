"""Learning Grounds as an LTI 1.1 app inside a Canvas LMS course.

Canvas Lite (and any Canvas LMS course) lets a teacher add an external app with a consumer key and
shared secret (Course Settings > Apps > + App > Paste XML, using GET /lti/config.xml). The app then
shows in the course menu, and can be the tool on an assignment. When a student clicks it, their
browser POSTs a launch signed with OAuth 1.0a HMAC-SHA1. We check the signature, keep the Canvas LMS
facts for a few minutes under a one-time code, and send the browser to the web app, which claims them
after Auth0 login and fills the Student Profile.

Configuration (api/.env): LTI_CONSUMER_KEY, LTI_SHARED_SECRET, optionally LTI_LAUNCH_URL.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import quote, urlsplit, urlunsplit
from xml.sax.saxutils import escape

from pydantic import BaseModel

import canvas_lms

TIMESTAMP_WINDOW_SECONDS = 5 * 60
HANDOFF_TTL_SECONDS = 10 * 60
LANGUAGES = ("pt", "es", "en")

# Canvas LMS fills these in at launch. Unavailable ones arrive as the literal "$Name", which we drop.
CUSTOM_FIELDS = {
    "person_name": "$Person.name.full",
    "person_email": "$Person.email.primary",
    "locale": "$Message.locale",
    "canvas_user_id": "$Canvas.user.id",
    "course_name": "$Canvas.course.name",
    "course_code": "$com.instructure.contextLabel",
    "section_names": "$com.instructure.User.sectionNames",
    "term_name": "$Canvas.term.name",
    "assignment_title": "$Canvas.assignment.title",
    "assignment_due_at": "$Canvas.assignment.dueAt.iso8601",
    "assignment_points": "$Canvas.assignment.pointsPossible",
    "canvas_lms_domain": "$Canvas.api.domain",
}

_used_nonces: dict[str, float] = {}
_handoffs: dict[str, tuple[float, "CanvasLmsLaunch"]] = {}


class LtiError(Exception):
    """A launch we won't accept. The message is safe to show on the launch page."""


class LtiConfigError(LtiError):
    pass


class CanvasLmsLaunch(BaseModel):
    """What Canvas LMS told us about the student at launch. Every field can be blank."""

    name: str = ""
    email: str = ""
    language: str = ""
    school: str = ""
    course: str = ""
    course_code: str = ""
    sections: list[str] = []
    term: str = ""
    roles: list[str] = []
    assignment_title: str = ""
    assignment_due_at: str = ""
    assignment_points: str = ""
    # "Course: assignment (due ...)", ready for the profile's Coming up box.
    upcoming_line: str = ""
    canvas_lms_domain: str = ""


@dataclass(frozen=True)
class LtiSettings:
    consumer_key: str
    shared_secret: str
    launch_url: str


def settings() -> LtiSettings:
    key = os.environ.get("LTI_CONSUMER_KEY", "").strip()
    secret = os.environ.get("LTI_SHARED_SECRET", "").strip()
    if not key or not secret:
        raise LtiConfigError("Learning Grounds isn't set up for Canvas LMS launches yet (LTI key missing).")
    launch_url = os.environ.get("LTI_LAUNCH_URL", "http://localhost:8000/lti/launch").strip()
    return LtiSettings(key, secret, launch_url)


# --- config XML --------------------------------------------------------------------------------


def config_xml() -> str:
    """The LTI 1.1 configuration a teacher pastes into Canvas LMS (Add App > Paste XML)."""
    launch = escape(settings().launch_url)
    domain = escape(urlsplit(settings().launch_url).hostname or "localhost")
    custom = "\n".join(
        f'      <lticm:property name="{name}">{escape(value)}</lticm:property>' for name, value in CUSTOM_FIELDS.items()
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<cartridge_basiclti_link xmlns="http://www.imsglobal.org/xsd/imslticc_v1p0"
    xmlns:blti="http://www.imsglobal.org/xsd/imsbasiclti_v1p0"
    xmlns:lticm="http://www.imsglobal.org/xsd/imslticm_v1p0"
    xmlns:lticp="http://www.imsglobal.org/xsd/imslticp_v1p0"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.imsglobal.org/xsd/imslticc_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imslticc_v1p0.xsd">
  <blti:title>Learning Grounds</blti:title>
  <blti:description>A voice tutor on a shared whiteboard. Opening it from Canvas LMS fills in your Student Profile.</blti:description>
  <blti:launch_url>{launch}</blti:launch_url>
  <blti:custom>
{custom}
  </blti:custom>
  <blti:extensions platform="canvas.instructure.com">
    <lticm:property name="tool_id">learning_grounds</lticm:property>
    <lticm:property name="privacy_level">public</lticm:property>
    <lticm:property name="domain">{domain}</lticm:property>
    <lticm:options name="course_navigation">
      <lticm:property name="enabled">true</lticm:property>
      <lticm:property name="text">Learning Grounds</lticm:property>
      <lticm:property name="visibility">public</lticm:property>
      <lticm:property name="default">enabled</lticm:property>
      <lticm:property name="windowTarget">_blank</lticm:property>
    </lticm:options>
  </blti:extensions>
</cartridge_basiclti_link>
"""


# --- OAuth 1.0a signature ------------------------------------------------------------------------


def _enc(value: str) -> str:
    # RFC 3986 percent-encoding, as OAuth 1.0a requires: only unreserved characters stay as-is.
    return quote(value, safe="~-._")


def _base_url(url: str) -> str:
    parts = urlsplit(url)
    scheme, host = parts.scheme.lower(), (parts.hostname or "").lower()
    port = parts.port
    netloc = host if port is None or (scheme, port) in (("http", 80), ("https", 443)) else f"{host}:{port}"
    return urlunsplit((scheme, netloc, parts.path or "/", "", ""))


def signature(method: str, url: str, params: list[tuple[str, str]], secret: str) -> str:
    pairs = sorted((_enc(k), _enc(v)) for k, v in params if k != "oauth_signature")
    normalized = "&".join(f"{k}={v}" for k, v in pairs)
    base = "&".join([method.upper(), _enc(_base_url(url)), _enc(normalized)])
    digest = hmac.new(f"{_enc(secret)}&".encode(), base.encode(), hashlib.sha1).digest()
    return base64.b64encode(digest).decode()


def verify_launch(url: str, params: list[tuple[str, str]], now: float | None = None) -> dict[str, str]:
    """Checks an LTI 1.1 launch POST. Returns its fields, or raises LtiError."""
    now = time.time() if now is None else now
    config = settings()
    fields = dict(params)
    if fields.get("oauth_signature_method") != "HMAC-SHA1":
        raise LtiError("This launch isn't signed the way Learning Grounds expects.")
    if fields.get("oauth_consumer_key") != config.consumer_key:
        raise LtiError("This launch came from an app with a different key. Check the key in Canvas LMS.")
    expected = signature("POST", url, params, config.shared_secret)
    if not hmac.compare_digest(expected, fields.get("oauth_signature", "")):
        raise LtiError("This launch's signature didn't match. Check the shared secret in Canvas LMS.")
    try:
        timestamp = int(fields.get("oauth_timestamp", ""))
    except ValueError as error:
        raise LtiError("This launch has no valid time.") from error
    if abs(now - timestamp) > TIMESTAMP_WINDOW_SECONDS:
        raise LtiError("This launch is too old. Please open Learning Grounds from Canvas LMS again.")
    nonce = fields.get("oauth_nonce", "")
    for old, expiry in list(_used_nonces.items()):
        if expiry < now:
            del _used_nonces[old]
    if not nonce or nonce in _used_nonces:
        raise LtiError("This launch was already used. Please open Learning Grounds from Canvas LMS again.")
    _used_nonces[nonce] = now + 2 * TIMESTAMP_WINDOW_SECONDS
    if fields.get("lti_message_type") != "basic-lti-launch-request":
        raise LtiError("Learning Grounds only handles regular launches from Canvas LMS.")
    return fields


# --- launch data -------------------------------------------------------------------------------


def _clean(value: str | None, limit: int = 200) -> str:
    value = (value or "").strip()
    # Canvas LMS sends a variable it couldn't fill as its own name, e.g. "$Canvas.assignment.title".
    return "" if value.startswith("$") else value[:limit]


def _language(locale: str) -> str:
    locale = locale.lower()
    return next((lang for lang in LANGUAGES if locale.startswith(lang)), "")


def _sections(raw: str) -> list[str]:
    try:
        names = json.loads(raw) if raw else []
    except ValueError:
        return []
    return [str(name)[:80] for name in names if isinstance(name, str)][:5] if isinstance(names, list) else []


def _roles(raw: str) -> list[str]:
    # "urn:lti:role:ims/lis/Learner,Instructor" becomes ["Learner", "Instructor"].
    roles = {part.rsplit("/", 1)[-1].rsplit(":", 1)[-1] for part in raw.split(",") if part.strip()}
    return sorted(roles)


def launch_data(fields: dict[str, str]) -> CanvasLmsLaunch:
    get = lambda name, limit=200: _clean(fields.get(name), limit)  # noqa: E731
    course = get("custom_course_name") or get("context_title")
    title = get("custom_assignment_title")
    due_at = get("custom_assignment_due_at", 40)
    line = ""
    if title:
        due = None
        try:
            due = datetime.fromisoformat(due_at.replace("Z", "+00:00")).astimezone(canvas_lms.timezone()) if due_at else None
        except ValueError:
            due = None
        line = canvas_lms.upcoming_line(course, title, due) if due else f"{course + ': ' if course else ''}{title}"
    return CanvasLmsLaunch(
        name=get("custom_person_name") or get("lis_person_name_full"),
        email=get("custom_person_email") or get("lis_person_contact_email_primary"),
        language=_language(get("custom_locale", 20) or get("launch_presentation_locale", 20)),
        school=get("tool_consumer_instance_name"),
        course=course,
        course_code=get("custom_course_code") or get("context_label"),
        sections=_sections(fields.get("custom_section_names", "")),
        term=get("custom_term_name"),
        roles=_roles(fields.get("roles", "")),
        assignment_title=title,
        assignment_due_at=due_at,
        assignment_points=get("custom_assignment_points", 20),
        upcoming_line=line,
        canvas_lms_domain=get("custom_canvas_lms_domain", 120),
    )


def hand_off(launch: CanvasLmsLaunch, now: float | None = None) -> str:
    """Keeps the launch for HANDOFF_TTL_SECONDS under a one-time code for the web app to claim."""
    now = time.time() if now is None else now
    for code, (expiry, _) in list(_handoffs.items()):
        if expiry < now:
            del _handoffs[code]
    code = secrets.token_urlsafe(24)
    _handoffs[code] = (now + HANDOFF_TTL_SECONDS, launch)
    return code


def claim(code: str, now: float | None = None) -> CanvasLmsLaunch | None:
    now = time.time() if now is None else now
    entry = _handoffs.pop(code, None)
    if not entry or entry[0] < now:
        return None
    return entry[1]
