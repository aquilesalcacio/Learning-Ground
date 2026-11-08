"""Canvas LMS connection tests. A fake Canvas LMS runs on httpx.MockTransport; no network is used."""
import time
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient

import canvas_lms
from canvas_lms import CanvasLmsError, CanvasLmsNotConnected, Tokens
from conftest import TEST_USER
from main import app

BASE = "https://learning-grounds.instructure.com"
client = TestClient(app, follow_redirects=False)


class FakeCanvasLms:
    """Just enough Canvas LMS: OAuth token endpoint, users/self, courses (2 pages) and assignments."""

    def __init__(self):
        self.access_token = "access-1"
        self.refresh_calls = 0
        self.revoked = False
        self.requests: list[httpx.Request] = []
        self.refresh_fails = False
        self.expire_next_api_call = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        assert request.headers["User-Agent"].startswith("LearningGrounds/")
        path = request.url.path
        if path == "/login/oauth2/token" and request.method == "POST":
            form = parse_qs(request.content.decode())
            assert form["client_id"] == ["10000000000001"] and form["client_secret"] == ["shh"]
            if form["grant_type"] == ["authorization_code"]:
                if form["code"] != ["good-code"]:
                    return httpx.Response(400, json={"error": "invalid_grant"})
                return httpx.Response(
                    200,
                    json={
                        "access_token": "access-1",
                        "refresh_token": "refresh-1",
                        "expires_in": 3600,
                        "user": {"id": 42, "name": "Maria Silva"},
                    },
                )
            self.refresh_calls += 1
            if self.refresh_fails:
                return httpx.Response(400, json={"error": "invalid_grant"})
            self.access_token = f"access-{self.refresh_calls + 1}"
            return httpx.Response(200, json={"access_token": self.access_token, "expires_in": 3600})
        if path == "/login/oauth2/token" and request.method == "DELETE":
            self.revoked = True
            return httpx.Response(200, json={})

        if self.expire_next_api_call:
            self.expire_next_api_call = False
            self.access_token = "rotated"
        if request.headers.get("Authorization") != f"Bearer {self.access_token}":
            return httpx.Response(401, json={"errors": [{"message": "Invalid access token."}]})
        if path == "/api/v1/users/self":
            return httpx.Response(200, json={"id": 42, "name": "Maria Silva", "locale": None, "effective_locale": "pt-BR"})
        if path == "/api/v1/courses":
            if request.url.params.get("page") == "2":
                return httpx.Response(200, json=[course(3, "Biology 101", "Miami Dade College")])
            next_link = f'<{BASE}/api/v1/courses?page=2&per_page=50>; rel="next"'
            return httpx.Response(
                200,
                json=[
                    course(1, "Algebra I", "Miami Dade College"),
                    course(2, "Old Course", "Manually-Created Courses", restricted=True),
                ],
                headers={"Link": next_link},
            )
        if path == "/api/v1/courses/1/assignments":
            assert request.url.params["bucket"] == "upcoming"
            return httpx.Response(
                200,
                json=[
                    {"name": "Quiz: linear equations", "due_at": "2026-11-13T04:59:00Z"},
                    {"name": "No due date", "due_at": None},
                ],
            )
        if path == "/api/v1/courses/3/assignments":
            return httpx.Response(200, json=[{"name": "Lab report", "due_at": "2026-11-10T14:00:00Z"}])
        return httpx.Response(404, json={})


def course(course_id, name, account, restricted=False):
    data = {"id": course_id, "name": name, "account": {"name": account}}
    if restricted:
        data = {"id": course_id, "access_restricted_by_date": True}
    return data


@pytest.fixture
def fake(monkeypatch, tmp_path):
    monkeypatch.setenv("CANVAS_LMS_BASE_URL", BASE)
    monkeypatch.setenv("CANVAS_LMS_CLIENT_ID", "10000000000001")
    monkeypatch.setenv("CANVAS_LMS_CLIENT_SECRET", "shh")
    monkeypatch.setenv("CANVAS_LMS_REDIRECT_URI", "http://localhost:8000/canvas-lms/callback")
    monkeypatch.setenv("CANVAS_LMS_STATE_SECRET", "test-secret")
    monkeypatch.setenv("CANVAS_LMS_DB_PATH", str(tmp_path / "canvas_lms.sqlite"))
    monkeypatch.delenv("CANVAS_LMS_SCOPES", raising=False)
    fake = FakeCanvasLms()
    monkeypatch.setattr(canvas_lms, "_transport", httpx.MockTransport(fake.handler))
    canvas_lms._used_nonces.clear()
    return fake


def status() -> tuple[bool, str]:
    data = client.get("/canvas-lms/status").json()
    return data["connected"], data["canvas_lms_user"]


def connect(fake) -> None:
    url = client.post("/canvas-lms/connect").json()["url"]
    state = parse_qs(urlparse(url).query)["state"][0]
    response = client.get("/canvas-lms/callback", params={"state": state, "code": "good-code"})
    assert response.headers["location"].endswith("/profile?canvas_lms=connected")


def test_connect_builds_authorize_url(fake):
    url = urlparse(client.post("/canvas-lms/connect").json()["url"])
    query = parse_qs(url.query)
    assert f"{url.scheme}://{url.netloc}{url.path}" == f"{BASE}/login/oauth2/auth"
    assert query["client_id"] == ["10000000000001"]
    assert query["response_type"] == ["code"]
    assert query["redirect_uri"] == ["http://localhost:8000/canvas-lms/callback"]
    assert "url:GET|/api/v1/courses" in query["scope"][0]
    assert canvas_lms.read_state(query["state"][0]) == TEST_USER


def test_empty_scopes_setting_sends_no_scope(fake, monkeypatch):
    monkeypatch.setenv("CANVAS_LMS_SCOPES", "")
    assert "scope" not in parse_qs(urlparse(canvas_lms.authorize_url("x")).query)


def test_full_flow_imports_profile(fake):
    assert status() == (False, "")
    connect(fake)
    assert status() == (True, "Maria Silva")
    assert client.get("/canvas-lms/status").json()["oauth_available"] is True

    profile = client.get("/canvas-lms/profile").json()
    assert profile == {
        "name": "Maria Silva",
        "school": "Miami Dade College",
        "courses": "Algebra I\nBiology 101",
        "language": "pt",
        # Sorted by due date and shown in Miami time; the undated assignment is left out.
        "upcoming": "Biology 101: Lab report (due Tue Nov 10, 9:00 AM)\n"
        "Algebra I: Quiz: linear equations (due Thu Nov 12, 11:59 PM)",
    }


def test_profile_before_connecting_is_409(fake):
    response = client.get("/canvas-lms/profile")
    assert response.status_code == 409
    assert response.json()["detail"] == "Connect Canvas LMS first."


def test_expired_token_is_refreshed_before_calls(fake):
    connect(fake)
    tokens = canvas_lms.load_tokens(TEST_USER)
    tokens.expires_at = time.time() - 5
    canvas_lms.save_tokens(TEST_USER, tokens)
    assert client.get("/canvas-lms/profile").status_code == 200
    assert fake.refresh_calls == 1
    assert canvas_lms.load_tokens(TEST_USER).access_token == "access-2"


def test_401_mid_import_refreshes_once(fake):
    connect(fake)
    fake.expire_next_api_call = True
    # The fake rotates the token, so the stored one fails until a refresh brings a new one.
    response = client.get("/canvas-lms/profile")
    assert response.status_code == 200
    assert fake.refresh_calls == 1


def test_failed_refresh_forgets_the_connection(fake):
    connect(fake)
    tokens = canvas_lms.load_tokens(TEST_USER)
    tokens.expires_at = 0
    canvas_lms.save_tokens(TEST_USER, tokens)
    fake.refresh_fails = True
    assert client.get("/canvas-lms/profile").status_code == 409
    assert canvas_lms.load_tokens(TEST_USER) is None


def test_bad_code_redirects_with_error(fake):
    state = canvas_lms.sign_state(TEST_USER)
    response = client.get("/canvas-lms/callback", params={"state": state, "code": "stolen"})
    assert response.headers["location"].endswith("canvas_lms=error")
    assert canvas_lms.load_tokens(TEST_USER) is None


def test_student_denies_access(fake):
    response = client.get("/canvas-lms/callback", params={"error": "access_denied", "state": "x"})
    assert response.headers["location"].endswith("canvas_lms=denied")


@pytest.mark.parametrize("make_state", [lambda s: s[:-2] + "xx", lambda s: "garbage", lambda s: ""])
def test_tampered_state_redirects_with_error(fake, make_state):
    state = make_state(canvas_lms.sign_state(TEST_USER))
    response = client.get("/canvas-lms/callback", params={"state": state, "code": "good-code"})
    assert response.headers["location"].endswith("canvas_lms=error")
    assert canvas_lms.load_tokens(TEST_USER) is None


def test_state_expires(fake):
    state = canvas_lms.sign_state(TEST_USER, now=time.time() - canvas_lms.STATE_TTL_SECONDS - 1)
    with pytest.raises(CanvasLmsError, match="expired"):
        canvas_lms.read_state(state)


def test_state_is_single_use(fake):
    state = canvas_lms.sign_state(TEST_USER)
    canvas_lms.read_state(state)
    with pytest.raises(CanvasLmsError, match="already used"):
        canvas_lms.read_state(state)


def test_disconnect_revokes_and_forgets(fake):
    connect(fake)
    assert client.post("/canvas-lms/disconnect").json()["connected"] is False
    assert fake.revoked
    assert canvas_lms.load_tokens(TEST_USER) is None


def test_missing_config_is_503(fake, monkeypatch):
    monkeypatch.delenv("CANVAS_LMS_CLIENT_ID")
    assert client.post("/canvas-lms/connect").status_code == 503


def test_tokens_are_per_student(fake):
    canvas_lms.save_tokens("auth0|other", Tokens("a", "r", time.time() + 999, "7", "Someone Else"))
    assert client.get("/canvas-lms/status").json()["connected"] is False


def test_unreachable_canvas_lms_is_502(fake, monkeypatch):
    connect(fake)

    def down(request):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(canvas_lms, "_transport", httpx.MockTransport(down))
    response = client.get("/canvas-lms/profile")
    assert response.status_code == 502


def test_not_connected_is_a_canvas_lms_error():
    assert issubclass(CanvasLmsNotConnected, CanvasLmsError)
