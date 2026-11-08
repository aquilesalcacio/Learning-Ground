"""Tutor session credentials. A fake ElevenLabs runs on httpx.MockTransport; no network is used."""
import httpx
import pytest
from fastapi.testclient import TestClient

import voice_session
from main import app

client = TestClient(app)


@pytest.fixture
def eleven(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "xi-test")
    monkeypatch.setenv("ELEVENLABS_AGENT_ID", "agent_test")
    calls: list[httpx.Request] = []
    replies: dict[str, httpx.Response] = {
        "/v1/convai/conversation/token": httpx.Response(200, json={"token": "tok-123", "conversation_id": "c1"}),
        "/v1/convai/conversation/get-signed-url": httpx.Response(200, json={"signed_url": "wss://example/convai?x=1"}),
    }

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return replies.get(request.url.path, httpx.Response(404))

    monkeypatch.setattr(voice_session, "_transport", httpx.MockTransport(handler))
    return calls, replies


def test_voice_gets_a_conversation_token(eleven):
    calls, _ = eleven
    response = client.post("/voice/session", json={"text_only": False})
    assert response.status_code == 200
    assert response.json() == {"conversation_token": "tok-123", "signed_url": None}
    assert calls[0].url.params["agent_id"] == "agent_test"
    assert calls[0].headers["xi-api-key"] == "xi-test"


def test_text_gets_a_signed_url(eleven):
    response = client.post("/voice/session", json={"text_only": True})
    assert response.status_code == 200
    assert response.json() == {"conversation_token": None, "signed_url": "wss://example/convai?x=1"}


def test_no_body_means_a_voice_call(eleven):
    assert client.post("/voice/session").json()["conversation_token"] == "tok-123"


def test_elevenlabs_refusal_is_a_safe_502(eleven):
    _, replies = eleven
    replies["/v1/convai/conversation/token"] = httpx.Response(401, json={"detail": "invalid api key xi-test"})
    response = client.post("/voice/session", json={"text_only": False})
    assert response.status_code == 502
    assert "xi-test" not in response.text


def test_missing_settings_are_a_503(monkeypatch):
    monkeypatch.delenv("ELEVENLABS_AGENT_ID", raising=False)
    monkeypatch.setenv("ELEVENLABS_API_KEY", "xi-test")
    assert client.post("/voice/session").status_code == 503


@pytest.mark.real_auth
def test_needs_a_logged_in_student():
    assert client.post("/voice/session").status_code == 401
