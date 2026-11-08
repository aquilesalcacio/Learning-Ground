"""Starts a tutor session for a logged-in student (T-203).

The ElevenLabs agent requires auth, so a browser can't start a session with the agent ID alone and
spend our minutes. The web app asks this API instead, and gets a one-time credential from ElevenLabs:
a conversation token for a voice call (WebRTC), or a signed URL for a text chat (WebSocket). Each
expires within minutes and starts one conversation. The API key never leaves the server.
"""
import logging
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel

load_dotenv(Path(__file__).resolve().parent / ".env")

log = logging.getLogger("learning_grounds.voice_session")

BASE_URL = "https://api.elevenlabs.io"
# Replaced in tests with a fake ElevenLabs.
_transport: httpx.AsyncBaseTransport | None = None


class VoiceSessionConfigError(Exception):
    """The server has no ElevenLabs key or agent ID."""


class VoiceSessionError(Exception):
    """ElevenLabs didn't give us a session. The message is safe to show the student."""


class VoiceSession(BaseModel):
    # Exactly one is set: the token for a voice call, the URL for a text chat.
    conversation_token: str | None = None
    signed_url: str | None = None


def _settings() -> tuple[str, str]:
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    agent_id = os.environ.get("ELEVENLABS_AGENT_ID", "").strip()
    if not key or not agent_id:
        raise VoiceSessionConfigError("ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID must be set in api/.env.")
    return key, agent_id


async def start_session(text_only: bool) -> VoiceSession:
    key, agent_id = _settings()
    path = "/v1/convai/conversation/get-signed-url" if text_only else "/v1/convai/conversation/token"
    async with httpx.AsyncClient(
        base_url=BASE_URL, headers={"xi-api-key": key}, timeout=10.0, transport=_transport
    ) as http:
        try:
            response = await http.get(path, params={"agent_id": agent_id})
        except httpx.HTTPError as error:
            log.warning("ElevenLabs session request failed: %s", type(error).__name__)
            raise VoiceSessionError("The tutor can't be reached right now. Please try again.") from error
    if response.status_code != 200:
        log.warning("ElevenLabs refused a session: %s %s", response.status_code, response.text[:200])
        raise VoiceSessionError("The tutor can't start a session right now. Please try again in a minute.")
    body = response.json()
    if text_only and isinstance(body.get("signed_url"), str):
        return VoiceSession(signed_url=body["signed_url"])
    if not text_only and isinstance(body.get("token"), str):
        return VoiceSession(conversation_token=body["token"])
    log.warning("ElevenLabs answered without a session credential: %s", sorted(body))
    raise VoiceSessionError("The tutor can't start a session right now. Please try again in a minute.")
