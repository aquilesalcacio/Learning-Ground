"""The guest ID check that stands in for login."""
import pytest
from fastapi.testclient import TestClient

import auth
from main import app

pytestmark = pytest.mark.real_auth

GUEST = "0123456789abcdef0123456789abcdef"

client = TestClient(app)


def status_with(guest: str | None) -> int:
    headers = {"X-Guest-Id": guest} if guest is not None else {}
    return client.get("/canvas-lms/status", headers=headers).status_code


def test_guest_id_becomes_the_user():
    assert auth.require_user(GUEST) == f"guest|{GUEST}"


def test_guest_id_reaches_the_route(tmp_path, monkeypatch):
    monkeypatch.setenv("CANVAS_LMS_DB_PATH", str(tmp_path / "t.sqlite"))
    response = client.get("/canvas-lms/status", headers={"X-Guest-Id": GUEST})
    assert response.status_code == 200
    assert response.json()["connected"] is False


@pytest.mark.parametrize(
    "guest",
    [None, "", "abc", GUEST[:-1], GUEST + "0", GUEST.upper(), "g" * 32, f"{GUEST[:16]}|{GUEST[17:]}"],
)
def test_bad_guest_ids_get_401(guest):
    assert status_with(guest) == 401


def test_routes_need_a_guest_id():
    assert client.post("/check-work").status_code == 401
    assert client.post("/documents/read-page").status_code == 401
    assert client.post("/canvas-lms/connect").status_code == 401
    assert client.get("/canvas-lms/profile").status_code == 401
    assert client.post("/canvas-lms/disconnect").status_code == 401
    assert client.get("/health").status_code == 200
