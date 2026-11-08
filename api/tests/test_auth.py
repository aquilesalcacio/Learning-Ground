"""Auth0 token checks. A local RSA key stands in for the tenant's JWKS, so no network is used."""
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

import auth
from main import app

pytestmark = pytest.mark.real_auth

DOMAIN = "learning-grounds.us.auth0.com"
AUDIENCE = "https://api.learning-grounds.dev"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)

client = TestClient(app)


class FakeJwks:
    def get_signing_key_from_jwt(self, token):
        return type("SigningKey", (), {"key": KEY.public_key()})()


@pytest.fixture(autouse=True)
def tenant(monkeypatch):
    monkeypatch.setenv("AUTH0_DOMAIN", DOMAIN)
    monkeypatch.setenv("AUTH0_AUDIENCE", AUDIENCE)
    monkeypatch.delenv("AUTH_DISABLED", raising=False)
    monkeypatch.setattr(auth, "_jwks_client", lambda domain: FakeJwks())


def token(key=KEY, **overrides):
    now = int(time.time())
    claims = {"sub": "auth0|abc", "aud": AUDIENCE, "iss": f"https://{DOMAIN}/", "iat": now, "exp": now + 600}
    claims.update(overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, key, algorithm="RS256")


def status_with(header: str | None) -> int:
    headers = {"Authorization": header} if header is not None else {}
    return client.get("/canvas-lms/status", headers=headers).status_code


def test_valid_token_returns_sub():
    assert auth.verify_token(token()) == "auth0|abc"


def test_valid_token_reaches_the_route(tmp_path, monkeypatch):
    monkeypatch.setenv("CANVAS_LMS_DB_PATH", str(tmp_path / "t.sqlite"))
    response = client.get("/canvas-lms/status", headers={"Authorization": f"Bearer {token()}"})
    assert response.status_code == 200
    assert response.json()["connected"] is False


@pytest.mark.parametrize(
    "header",
    [
        None,
        "",
        "Bearer",
        "Basic abc",
        "Bearer not-a-jwt",
        f"Bearer {token(aud='https://someone-else')}",
        f"Bearer {token(iss='https://evil.auth0.com/')}",
        f"Bearer {token(exp=int(time.time()) - 10)}",
        f"Bearer {token(key=OTHER_KEY)}",
        f"Bearer {token(sub=None)}",
    ],
)
def test_bad_tokens_get_401(header):
    assert status_with(header) == 401


def test_hs256_token_is_refused():
    forged = jwt.encode({"sub": "x", "aud": AUDIENCE, "iss": f"https://{DOMAIN}/"}, "secret" * 8, algorithm="HS256")
    assert status_with(f"Bearer {forged}") == 401


def test_protected_routes_need_a_token():
    assert client.post("/check-work").status_code == 401
    assert client.post("/documents/read-page").status_code == 401
    assert client.post("/canvas-lms/connect").status_code == 401
    assert client.get("/canvas-lms/profile").status_code == 401
    assert client.post("/canvas-lms/disconnect").status_code == 401
    assert client.get("/health").status_code == 200


def test_missing_config_is_503(monkeypatch):
    monkeypatch.delenv("AUTH0_DOMAIN")
    assert status_with(f"Bearer {token()}") == 503


def test_auth_disabled_uses_dev_user(monkeypatch):
    monkeypatch.setenv("AUTH_DISABLED", "1")
    assert auth.require_user(None) == auth.DEV_USER
