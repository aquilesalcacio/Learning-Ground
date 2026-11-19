"""Who is calling the API. There's no login.

Each browser makes a random 32-character guest ID once, keeps it, and sends it as `X-Guest-Id`
(web/lib/lg-api.ts). `require_user` returns `guest|<id>`, and the Canvas LMS data that browser saves
(calendar feed, course launches, turn-ins) is filed under it. The ID works like a session cookie: it
keeps one visitor's data apart from another's, and whoever holds it can use that data.
"""
import re
from typing import Annotated

from fastapi import Header, HTTPException

GUEST_ID = re.compile(r"[0-9a-f]{32}")


def require_user(x_guest_id: Annotated[str | None, Header()] = None) -> str:
    """FastAPI dependency: the calling browser's user ID, or a 401 without a valid guest ID."""
    guest = (x_guest_id or "").strip()
    if not GUEST_ID.fullmatch(guest):
        raise HTTPException(401, "Please reload the page and try again.")
    return f"guest|{guest}"
