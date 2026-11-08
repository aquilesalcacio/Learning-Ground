"""Turn in to Canvas LMS. A fake Canvas LMS outcomes endpoint checks the request with oauthlib."""
import base64
import hashlib
import re
import time
from urllib.parse import parse_qs, unquote, urlencode, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient
from oauthlib.oauth1 import SIGNATURE_TYPE_BODY, Client
from oauthlib.oauth1.rfc5849 import signature as oauth_signature

import canvas_lms_grades
import canvas_lms_lti
from conftest import TEST_USER
from main import app
from test_canvas_lms_lti import CANVAS_LMS_LAUNCH, KEY, LAUNCH_URL, SECRET

client = TestClient(app, follow_redirects=False)
OUTCOME_URL = "https://canvaslite.instructure.com/api/lti/v1/tools/123/grade_passback"
GRADED_LAUNCH = {
    **CANVAS_LMS_LAUNCH,
    "lis_outcome_service_url": OUTCOME_URL,
    "lis_result_sourcedid": "123-456-789-<&>",
}


class FakeOutcomes:
    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.answer = "success"

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        body = request.content
        header = request.headers["Authorization"]
        oauth = dict(re.findall(r'(\w+)="([^"]*)"', header))
        assert unquote(oauth["oauth_body_hash"]) == base64.b64encode(hashlib.sha1(body).digest()).decode()
        params = oauth_signature.collect_parameters(headers={"Authorization": header}, exclude_oauth_signature=True)
        base = oauth_signature.signature_base_string(
            "POST", oauth_signature.base_string_uri(str(request.url)), oauth_signature.normalize_parameters(params)
        )
        expected = oauth_signature.sign_hmac_sha1(base, SECRET, "")
        assert unquote(oauth["oauth_signature"]) == expected
        return httpx.Response(
            200,
            text=f"<imsx_POXEnvelopeResponse><imsx_codeMajor>{self.answer}</imsx_codeMajor></imsx_POXEnvelopeResponse>",
        )


@pytest.fixture(autouse=True)
def setup(monkeypatch, tmp_path):
    monkeypatch.setenv("LTI_CONSUMER_KEY", KEY)
    monkeypatch.setenv("LTI_SHARED_SECRET", SECRET)
    monkeypatch.setenv("LTI_LAUNCH_URL", LAUNCH_URL)
    monkeypatch.setenv("CANVAS_LMS_DB_PATH", str(tmp_path / "canvas_lms.sqlite"))
    canvas_lms_lti._used_nonces.clear()
    canvas_lms_lti._handoffs.clear()
    fake = FakeOutcomes()
    monkeypatch.setattr(canvas_lms_grades, "_transport", httpx.MockTransport(fake.handler))
    return fake


def launch_and_claim(fields=GRADED_LAUNCH) -> dict:
    oauth = Client(KEY, client_secret=SECRET, signature_type=SIGNATURE_TYPE_BODY)
    _, _, body = oauth.sign(
        LAUNCH_URL, http_method="POST", body=urlencode(fields), headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    response = client.post("/lti/launch", content=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
    code = parse_qs(urlparse(response.headers["location"]).query)["code"][0]
    return client.post("/canvas-lms/launch/claim", json={"code": code}).json()


def summary(turn_in_id: str, **extra) -> dict:
    return {
        "turn_in_id": turn_in_id,
        "tutor_name": "Sam",
        "started_at": int(time.mktime((2026, 11, 7, 21, 40, 0, 0, 0, -1)) * 1000),
        "minutes": 25,
        "student_messages": 8,
        "tutor_messages": 9,
        "checks": [{"label": "Problem 1", "status": "correct"}, {"label": "Problem 2", "status": "error"}],
        **extra,
    }


def test_graded_launch_gets_a_turn_in_id():
    assert launch_and_claim()["turn_in_id"]


def test_ungraded_launch_has_no_turn_in():
    assert launch_and_claim(CANVAS_LMS_LAUNCH)["turn_in_id"] == ""


def test_outcome_outside_canvas_lms_is_ignored():
    fields = {**GRADED_LAUNCH, "lis_outcome_service_url": "https://evil.example.com/grades"}
    assert launch_and_claim(fields)["turn_in_id"] == ""


def test_preview_shows_the_learning_grounds_label():
    turn_in_id = launch_and_claim()["turn_in_id"]
    preview = client.post("/canvas-lms/turn-in/preview", json=summary(turn_in_id)).json()
    assert "Submitted with Learning Grounds" in preview["html"]
    assert "Problem 2: has a mistake to fix" in preview["html"]
    assert preview["score"] == "1.0"


def test_turn_in_sends_a_signed_completion_score(setup):
    turn_in_id = launch_and_claim()["turn_in_id"]
    response = client.post("/canvas-lms/turn-in", json=summary(turn_in_id, note="I <3 cells"))
    assert response.status_code == 200
    (request,) = setup.requests
    xml = request.content.decode()
    assert "<textString>1.0</textString>" in xml
    assert "<prioritizeNonToolGrade/>" in xml
    assert "<sourcedId>123-456-789-&lt;&amp;&gt;</sourcedId>" in xml
    # The summary HTML is escaped once for HTML and once more for the XML around it.
    assert "I &amp;lt;3 cells" in xml
    assert "Submitted with Learning Grounds" in xml


def test_score_cannot_come_from_the_browser(setup):
    turn_in_id = launch_and_claim()["turn_in_id"]
    client.post("/canvas-lms/turn-in", json=summary(turn_in_id, score="0.0", resultScore="0"))
    assert "<textString>1.0</textString>" in setup.requests[0].content.decode()


def test_canvas_lms_refusal_is_502(setup):
    setup.answer = "failure"
    turn_in_id = launch_and_claim()["turn_in_id"]
    response = client.post("/canvas-lms/turn-in", json=summary(turn_in_id))
    assert response.status_code == 502


def test_someone_elses_turn_in_is_refused(setup):
    turn_in_id = launch_and_claim()["turn_in_id"]
    from auth import require_user

    app.dependency_overrides[require_user] = lambda: "auth0|someone-else"
    assert client.post("/canvas-lms/turn-in", json=summary(turn_in_id)).status_code == 502
    assert client.post("/canvas-lms/turn-in/preview", json=summary(turn_in_id)).status_code == 409
    assert setup.requests == []
    app.dependency_overrides[require_user] = lambda: TEST_USER


def test_bad_check_status_is_422():
    turn_in_id = launch_and_claim()["turn_in_id"]
    bad = summary(turn_in_id, checks=[{"label": "P1", "status": "perfect"}])
    assert client.post("/canvas-lms/turn-in", json=bad).status_code == 422
