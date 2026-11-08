"""Auth0 access-token checks for the API.

The web app logs students in with Auth0 and sends its access token as `Authorization: Bearer ...`.
`require_user` checks the token's RS256 signature against the tenant's JWKS, plus its audience,
issuer and expiry, and returns the Auth0 user ID (`sub`).

Set AUTH_DISABLED=1 in api/.env to skip the check during local work without an Auth0 tenant.
Never set it on a deployed server.
"""
import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Annotated

import jwt
from dotenv import load_dotenv
from fastapi import Header, HTTPException

log = logging.getLogger("learning_grounds.auth")

load_dotenv(Path(__file__).resolve().parent / ".env")

DEV_USER = "dev|local"


class AuthConfigError(Exception):
    """Auth0 isn't configured on the server."""


def _domain() -> str:
    domain = os.environ.get("AUTH0_DOMAIN", "").strip().removeprefix("https://").rstrip("/")
    if not domain:
        raise AuthConfigError("AUTH0_DOMAIN is missing")
    return domain


def _audience() -> str:
    audience = os.environ.get("AUTH0_AUDIENCE", "").strip()
    if not audience:
        raise AuthConfigError("AUTH0_AUDIENCE is missing")
    return audience


@lru_cache(maxsize=4)
def _jwks_client(domain: str) -> jwt.PyJWKClient:
    # PyJWKClient caches the keys and refetches when it sees an unknown key ID.
    return jwt.PyJWKClient(f"https://{domain}/.well-known/jwks.json", cache_keys=True, lifespan=3600)


def verify_token(token: str) -> str:
    """Returns the token's `sub`. Raises jwt.PyJWTError for any bad token."""
    domain = _domain()
    signing_key = _jwks_client(domain).get_signing_key_from_jwt(token)
    claims = jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        audience=_audience(),
        issuer=f"https://{domain}/",
        options={"require": ["exp", "iat", "sub"]},
    )
    return claims["sub"]


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(401, detail, headers={"WWW-Authenticate": "Bearer"})


def require_user(authorization: Annotated[str | None, Header()] = None) -> str:
    """FastAPI dependency: the logged-in student's Auth0 user ID, or a 401."""
    if os.environ.get("AUTH_DISABLED", "").strip() == "1":
        return DEV_USER
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise _unauthorized("Please log in first.")
    try:
        return verify_token(token.strip())
    except AuthConfigError as error:
        log.error("auth isn't configured: %s", error)
        raise HTTPException(503, "Login isn't set up on the server yet.") from error
    except (jwt.PyJWTError, jwt.PyJWKClientError) as error:
        log.info("rejected token: %s", type(error).__name__)
        raise _unauthorized("Your session has expired. Please log in again.") from error
