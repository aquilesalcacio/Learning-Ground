"""Endpoint tests. Gemini is faked here; scripts/eval_check_work.py tests the real model."""
import io
import sys
from pathlib import Path

import httpx2
import pytest
from fastapi.testclient import TestClient
from google.genai import errors
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import check_work as module  # noqa: E402
from check_work import MODELS, WorkCheck  # noqa: E402
from main import MAX_IMAGE_BYTES, app  # noqa: E402

client = TestClient(app)
RESULT = WorkCheck(status="error", student_wrote="6x + 5", analysis="Sign flipped in line 2.", hint="Check the sign?")
SECRET = "response text with key AIzaSyFAKEFAKEFAKE"


def png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (20, 20), "white").save(buffer, "PNG")
    return buffer.getvalue()


def post(data: bytes | None = None, **form):
    return client.post("/check-work", files={"image": ("work.png", png() if data is None else data, "image/png")}, data=form)


def api_error(code: int) -> errors.APIError:
    return errors.APIError(code, {"error": {"code": code, "message": SECRET, "status": "X"}})


@pytest.fixture
def gemini(monkeypatch):
    """Replaces the Gemini call. Set `outcomes` to the results or errors each model gives."""

    class Fake:
        outcomes: list = [RESULT]
        calls: list = []

    fake = Fake()
    fake.calls = []
    fake.outcomes = [RESULT]

    async def generate(_client, model, _image, _mime, prompt):
        fake.calls.append((model, prompt))
        outcome = fake.outcomes[min(len(fake.calls) - 1, len(fake.outcomes) - 1)]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr(module, "_generate", generate)
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    return fake


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_returns_the_check(gemini):
    response = post(language="pt", label="Problem 3")
    assert response.status_code == 200
    assert response.json() == RESULT.model_dump()
    assert gemini.calls[0][0] == MODELS[0]
    assert "Brazilian Portuguese" in gemini.calls[0][1]
    assert "Problem 3" in gemini.calls[0][1]


def test_missing_image_is_rejected(gemini):
    assert client.post("/check-work", data={"language": "en"}).status_code == 422
    assert gemini.calls == []


def test_non_image_is_rejected_even_if_labelled_png(gemini):
    assert post(b"%PDF-1.7 not an image").status_code == 415
    assert gemini.calls == []


def test_oversize_image_is_rejected(gemini):
    assert post(png() + b"0" * MAX_IMAGE_BYTES).status_code == 413
    assert gemini.calls == []


def test_unknown_language_is_rejected(gemini):
    assert post(language="fr").status_code == 422
    assert gemini.calls == []


def test_overlong_label_is_rejected(gemini):
    assert post(label="x" * 81).status_code == 422


@pytest.mark.parametrize("code", [429, 503])
def test_busy_model_falls_back_to_the_next(gemini, code):
    gemini.outcomes = [api_error(code), RESULT]
    assert post().status_code == 200
    assert [model for model, _ in gemini.calls] == list(MODELS[:2])


def test_bad_schema_falls_back_to_the_next(gemini):
    gemini.outcomes = [None, RESULT]
    assert post().status_code == 200
    assert len(gemini.calls) == 2


def test_all_models_busy_returns_502_without_leaking(gemini):
    gemini.outcomes = [api_error(429)]
    response = post()
    assert response.status_code == 502
    assert "busy" in response.json()["detail"]
    assert SECRET not in response.text


def test_rejected_request_does_not_retry_or_leak(gemini):
    gemini.outcomes = [api_error(400)]
    response = post()
    assert response.status_code == 502
    assert len(gemini.calls) == 1
    assert SECRET not in response.text


def test_network_failure_falls_back_to_the_next(gemini):
    gemini.outcomes = [httpx2.ReadTimeout("slow"), RESULT]
    assert post().status_code == 200
    assert len(gemini.calls) == 2


def test_every_model_failing_returns_502(gemini):
    gemini.outcomes = [TimeoutError(), httpx2.ReadTimeout("slow"), RuntimeError(SECRET)]
    response = post()
    assert response.status_code == 502
    assert len(gemini.calls) == len(MODELS)
    assert SECRET not in response.text


def test_missing_key_returns_502(gemini, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY")
    response = post()
    assert response.status_code == 502
    assert "GEMINI_API_KEY" in response.json()["detail"]
    assert gemini.calls == []


def test_cors_allows_the_web_app_only():
    def preflight(origin):
        return client.options("/check-work", headers={"Origin": origin, "Access-Control-Request-Method": "POST"})

    assert preflight("http://localhost:3000").headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert "access-control-allow-origin" not in preflight("https://evil.example").headers
