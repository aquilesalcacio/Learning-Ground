"""LTI 1.1 launch tests. Launches are signed with oauthlib, an independent OAuth 1.0a implementation."""
import time
from urllib.parse import parse_qs, urlencode, urlparse
from xml.etree import ElementTree

import pytest
from fastapi.testclient import TestClient
from oauthlib.oauth1 import SIGNATURE_TYPE_BODY, Client

import canvas_lms_lti
from main import app

LAUNCH_URL = "http://localhost:8000/lti/launch"
KEY, SECRET = "learning-grounds", "s3cret-shared"
client = TestClient(app, follow_redirects=False)

# What Canvas LMS sends when a student opens the app from an assignment in a Canvas Lite course.
CANVAS_LMS_LAUNCH = {
    "lti_message_type": "basic-lti-launch-request",
    "lti_version": "LTI-1p0",
    "resource_link_id": "abc123",
    "roles": "Learner",
    "context_title": "Sharkbyte test",
    "context_label": "SB-101",
    "lis_person_name_full": "Maria Silva",
    "tool_consumer_instance_name": "Canvas Lite",
    "launch_presentation_locale": "pt-BR",
    "custom_person_name": "Maria Silva",
    "custom_person_email": "maria@example.com",
    "custom_locale": "pt-BR",
    "custom_course_name": "Sharkbyte test",
    "custom_course_code": "SB-101",
    "custom_section_names": '["Sharkbyte test"]',
    "custom_term_name": "$Canvas.term.name",  # Canvas Lite has no terms, so it stays unfilled.
    "custom_assignment_title": "Lab report: cell structure",
    "custom_assignment_due_at": "2026-11-10T14:00:00Z",
    "custom_assignment_points": "10",
    "custom_canvas_lms_domain": "canvaslite.instructure.com",
}


@pytest.fixture(autouse=True)
def lti(monkeypatch):
    monkeypatch.setenv("LTI_CONSUMER_KEY", KEY)
    monkeypatch.setenv("LTI_SHARED_SECRET", SECRET)
    monkeypatch.setenv("LTI_LAUNCH_URL", LAUNCH_URL)
    canvas_lms_lti._used_nonces.clear()
    canvas_lms_lti._handoffs.clear()


def signed(fields: dict, key=KEY, secret=SECRET, url=LAUNCH_URL, timestamp=None) -> str:
    oauth = Client(key, client_secret=secret, signature_type=SIGNATURE_TYPE_BODY, timestamp=timestamp)
    _, _, body = oauth.sign(
        url, http_method="POST", body=urlencode(fields), headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    return body


def launch(body: str):
    return client.post("/lti/launch", content=body, headers={"Content-Type": "application/x-www-form-urlencoded"})


def test_config_xml_is_valid_and_points_at_the_launch():
    response = client.get("/lti/config.xml")
    assert response.status_code == 200
    root = ElementTree.fromstring(response.text)
    ns = {"blti": "http://www.imsglobal.org/xsd/imsbasiclti_v1p0", "lticm": "http://www.imsglobal.org/xsd/imslticm_v1p0"}
    assert root.find("blti:launch_url", ns).text == LAUNCH_URL
    props = {p.get("name"): p.text for p in root.iter("{http://www.imsglobal.org/xsd/imslticm_v1p0}property")}
    assert props["privacy_level"] == "public"
    assert props["course_name"] == "$Canvas.course.name"
    assert props["assignment_due_at"] == "$Canvas.assignment.dueAt.iso8601"
    assert props["windowTarget"] == "_blank"


def test_signed_launch_hands_off_to_the_profile():
    response = launch(signed(CANVAS_LMS_LAUNCH))
    assert response.status_code == 303
    location = urlparse(response.headers["location"])
    assert location.path == "/profile"
    code = parse_qs(location.query)["canvas_lms_launch"][0]

    claimed = client.post("/canvas-lms/launch/claim", json={"code": code})
    assert claimed.status_code == 200
    data = claimed.json()
    assert data["name"] == "Maria Silva"
    assert data["email"] == "maria@example.com"
    assert data["language"] == "pt"
    assert data["school"] == "Canvas Lite"
    assert data["course"] == "Sharkbyte test"
    assert data["course_code"] == "SB-101"
    assert data["sections"] == ["Sharkbyte test"]
    assert data["term"] == ""  # Unfilled variables are dropped.
    assert data["roles"] == ["Learner"]
    assert data["upcoming_line"] == "Sharkbyte test: Lab report: cell structure (due Tue Nov 10, 9:00 AM)"

    # One use only.
    assert client.post("/canvas-lms/launch/claim", json={"code": code}).status_code == 404


def test_course_menu_launch_without_assignment():
    fields = {k: v for k, v in CANVAS_LMS_LAUNCH.items() if not k.startswith("custom_assignment")}
    fields["custom_assignment_title"] = "$Canvas.assignment.title"
    code = parse_qs(urlparse(launch(signed(fields)).headers["location"]).query)["canvas_lms_launch"][0]
    data = client.post("/canvas-lms/launch/claim", json={"code": code}).json()
    assert data["assignment_title"] == "" and data["upcoming_line"] == ""
    assert data["course"] == "Sharkbyte test"


def test_full_lis_roles_are_shortened():
    fields = {**CANVAS_LMS_LAUNCH, "roles": "urn:lti:role:ims/lis/Instructor,urn:lti:instrole:ims/lis/Administrator"}
    assert canvas_lms_lti.launch_data(fields).roles == ["Administrator", "Instructor"]


@pytest.mark.parametrize(
    "body_kwargs",
    [
        {"secret": "wrong-secret"},
        {"key": "someone-else"},
        {"url": "http://localhost:8000/lti/other"},
        {"timestamp": str(int(time.time()) - 3600)},
    ],
)
def test_bad_launches_are_refused(body_kwargs):
    response = launch(signed(CANVAS_LMS_LAUNCH, **body_kwargs))
    assert response.status_code == 401
    assert "Learning Grounds couldn't open" in response.text


def test_tampered_field_is_refused():
    body = signed(CANVAS_LMS_LAUNCH).replace("Maria+Silva", "Someone+Else")
    assert launch(body).status_code == 401


def test_replayed_launch_is_refused():
    body = signed(CANVAS_LMS_LAUNCH)
    assert launch(body).status_code == 303
    assert launch(body).status_code == 401


def test_other_message_types_are_refused():
    fields = {**CANVAS_LMS_LAUNCH, "lti_message_type": "ContentItemSelectionRequest"}
    assert launch(signed(fields)).status_code == 401


def test_error_page_escapes_html(monkeypatch):
    monkeypatch.setattr(canvas_lms_lti, "verify_launch", lambda *a: (_ for _ in ()).throw(canvas_lms_lti.LtiError("<b>x</b>")))
    assert "&lt;b&gt;" in launch("a=b").text


def test_missing_lti_config():
    for name in ("LTI_CONSUMER_KEY", "LTI_SHARED_SECRET"):
        pytest.MonkeyPatch().delenv(name, raising=False)
    assert client.get("/lti/config.xml").status_code == 503
    assert launch(signed(CANVAS_LMS_LAUNCH)).status_code == 401


def test_status_reports_lti_ready():
    assert client.get("/canvas-lms/status").json()["lti_ready"] is True


def test_claim_needs_login():
    from auth import require_user

    app.dependency_overrides.pop(require_user, None)
    assert client.post("/canvas-lms/launch/claim", json={"code": "x"}).status_code in (401, 503)
