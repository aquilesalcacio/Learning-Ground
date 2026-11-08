"""FastAPI backend for Learning Grounds.

    uv run uvicorn main:app --reload --port 8000

Endpoints: POST /check-work (Check my work), POST /documents/read-page (homework pages), and the
Canvas LMS connection under /canvas-lms/*. Every endpoint except /health and the Canvas LMS callback
needs an Auth0 access token (see auth.py).

Run from api/. Reads its keys from api/.env.
"""
import logging
import os
from typing import Annotated

from urllib.parse import urlencode

from html import escape

from fastapi import Body, Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse, Response

import canvas_lms
import canvas_lms_feed
import canvas_lms_lti
from canvas_lms_feed import CalendarFeedError, CalendarFeedImport
from canvas_lms_lti import CanvasLmsLaunch, LtiConfigError, LtiError
from auth import require_user
from canvas_lms import CanvasLmsConfigError, CanvasLmsError, CanvasLmsNotConnected, CanvasLmsProfile, CanvasLmsStatus
from check_work import CheckWorkError, Language, WorkCheck, check_work
from read_page import MAX_IMAGE_BYTES as MAX_PAGE_BYTES
from read_page import BadImageError, PageReading, ReadPageError, read_page

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("learning_grounds.api")

MAX_IMAGE_BYTES = 5 * 1024 * 1024
DEFAULT_WEB_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000"
WEB_BASE_URL = os.environ.get("WEB_BASE_URL", "http://localhost:3000").rstrip("/")
IMAGE_SIGNATURES = {b"\x89PNG\r\n\x1a\n": "image/png", b"\xff\xd8\xff": "image/jpeg"}

app = FastAPI(title="Learning Grounds API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("WEB_ORIGINS", DEFAULT_WEB_ORIGINS).split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

User = Annotated[str, Depends(require_user)]


def image_mime_type(data: bytes) -> str | None:
    # Checks the bytes, because the declared content type comes from the client.
    return next((mime for signature, mime in IMAGE_SIGNATURES.items() if data.startswith(signature)), None)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/check-work")
async def post_check_work(
    user: User,
    image: Annotated[UploadFile, File()],
    language: Annotated[Language, Form()] = "en",
    label: Annotated[str, Form(max_length=80)] = "",
) -> WorkCheck:
    data = await image.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "The snapshot is larger than 5 MB.")
    mime_type = image_mime_type(data)
    if not mime_type:
        raise HTTPException(415, "The snapshot must be a PNG or JPEG image.")
    try:
        return await check_work(data, mime_type, language, label)
    except CheckWorkError as error:
        raise HTTPException(502, str(error)) from error


@app.post("/documents/read-page")
async def post_read_page(
    user: User,
    image: Annotated[UploadFile, File()],
    language: Annotated[Language, Form()] = "en",
    page: Annotated[int, Form(ge=1, le=999)] = 1,
) -> PageReading:
    data = await image.read(MAX_PAGE_BYTES + 1)
    try:
        return await read_page(data, language, page)
    except BadImageError as error:
        raise HTTPException(error.status, str(error)) from error
    except ReadPageError as error:
        raise HTTPException(502, str(error)) from error
    except Exception as error:
        # The page stays usable on the board without a reading, so nothing here may crash the request.
        log.exception("read page failed unexpectedly: %s", type(error).__name__)
        raise HTTPException(502, "We couldn't read this page. You can still work on it on the board.") from error


# --- Canvas LMS ------------------------------------------------------------------------------


def canvas_lms_http_error(error: CanvasLmsError) -> HTTPException:
    if isinstance(error, CanvasLmsNotConnected):
        return HTTPException(409, str(error))
    if isinstance(error, CanvasLmsConfigError):
        log.error("canvas lms isn't configured: %s", error)
        return HTTPException(503, "Canvas LMS isn't set up on the server yet.")
    return HTTPException(502, str(error))


@app.post("/canvas-lms/connect")
def post_canvas_lms_connect(user: User) -> dict[str, str]:
    """The Canvas LMS authorize URL for this student. The browser goes there next."""
    try:
        return {"url": canvas_lms.authorize_url(user)}
    except CanvasLmsError as error:
        raise canvas_lms_http_error(error) from error


@app.get("/canvas-lms/callback", include_in_schema=False)
async def get_canvas_lms_callback(
    state: Annotated[str, Query(max_length=1000)] = "",
    code: Annotated[str, Query(max_length=1000)] = "",
    error: Annotated[str, Query(max_length=200)] = "",
) -> RedirectResponse:
    """Canvas LMS sends the browser here. No bearer token: the signed state names the student."""

    def back(result: str) -> RedirectResponse:
        return RedirectResponse(f"{WEB_BASE_URL}/profile?{urlencode({'canvas_lms': result})}", status_code=303)

    if error:
        return back("denied" if error == "access_denied" else "error")
    try:
        user = canvas_lms.read_state(state)
        if not code:
            return back("error")
        await canvas_lms.exchange_code(user, code)
    except CanvasLmsError as failure:
        log.info("canvas lms callback failed: %s", failure)
        return back("error")
    return back("connected")


@app.get("/canvas-lms/status")
def get_canvas_lms_status(user: User) -> CanvasLmsStatus:
    status = canvas_lms.status(user)
    status.calendar_feed = canvas_lms_feed.load_url(user) is not None
    try:
        canvas_lms_lti.settings()
        status.lti_ready = True
    except LtiConfigError:
        status.lti_ready = False
    return status


@app.get("/canvas-lms/profile")
async def get_canvas_lms_profile(user: User) -> CanvasLmsProfile:
    try:
        return await canvas_lms.fetch_profile(user)
    except CanvasLmsError as error:
        raise canvas_lms_http_error(error) from error


@app.post("/canvas-lms/disconnect")
async def post_canvas_lms_disconnect(user: User) -> CanvasLmsStatus:
    await canvas_lms.disconnect(user)
    return CanvasLmsStatus(connected=False)


# --- Canvas LMS: LTI 1.1 app inside a course ------------------------------------------------------


def lti_error_page(message: str) -> str:
    return (
        "<!doctype html><meta charset='utf-8'><title>Learning Grounds</title>"
        "<body style='font:16px system-ui;max-width:560px;margin:15vh auto;padding:0 16px'>"
        f"<h1>Learning Grounds couldn't open</h1><p>{escape(message)}</p></body>"
    )


@app.get("/lti/config.xml", include_in_schema=False)
def get_lti_config() -> Response:
    """The XML a teacher pastes into Canvas LMS: Course Settings > Apps > + App > Paste XML."""
    try:
        return Response(canvas_lms_lti.config_xml(), media_type="application/xml")
    except LtiConfigError as error:
        raise HTTPException(503, str(error)) from error


@app.post("/lti/launch", include_in_schema=False)
async def post_lti_launch(request: Request) -> Response:
    """Canvas LMS posts the student's browser here. No bearer token: the OAuth 1.0a signature proves it."""
    form = await request.form()
    params = [(k, v) for k, v in form.multi_items() if isinstance(v, str)]
    params += list(request.query_params.multi_items())
    try:
        # Canvas LMS signs the launch URL from the config, so check against that, not our Host header.
        fields = canvas_lms_lti.verify_launch(canvas_lms_lti.settings().launch_url, params)
    except LtiError as error:
        log.info("rejected lti launch: %s", error)
        return HTMLResponse(lti_error_page(str(error)), status_code=401)
    code = canvas_lms_lti.hand_off(canvas_lms_lti.launch_data(fields))
    return RedirectResponse(f"{WEB_BASE_URL}/profile?{urlencode({'canvas_lms_launch': code})}", status_code=303)


@app.post("/canvas-lms/launch/claim")
def post_canvas_lms_launch_claim(user: User, code: Annotated[str, Body(embed=True, max_length=100)]) -> CanvasLmsLaunch:
    """The logged-in student collects what Canvas LMS sent at launch. Each code works once."""
    launch = canvas_lms_lti.claim(code)
    if not launch:
        raise HTTPException(404, "That Canvas LMS launch expired. Open Learning Grounds from Canvas LMS again.")
    return launch


# --- Canvas LMS: calendar feed ----------------------------------------------------------------------


@app.post("/canvas-lms/calendar-feed")
async def post_canvas_lms_calendar_feed(
    user: User, url: Annotated[str, Body(embed=True, max_length=500)]
) -> CalendarFeedImport:
    try:
        result = await canvas_lms_feed.fetch(url)
    except CalendarFeedError as error:
        raise HTTPException(400, str(error)) from error
    canvas_lms_feed.save_url(user, canvas_lms_feed.check_url(url))
    return result


@app.get("/canvas-lms/calendar-feed")
async def get_canvas_lms_calendar_feed(user: User) -> CalendarFeedImport:
    url = canvas_lms_feed.load_url(user)
    if not url:
        raise HTTPException(409, "Add your Canvas LMS calendar feed first.")
    try:
        return await canvas_lms_feed.fetch(url)
    except CalendarFeedError as error:
        raise HTTPException(502, str(error)) from error


@app.post("/canvas-lms/calendar-feed/remove")
def post_canvas_lms_calendar_feed_remove(user: User) -> dict[str, bool]:
    canvas_lms_feed.delete_url(user)
    return {"calendar_feed": False}
