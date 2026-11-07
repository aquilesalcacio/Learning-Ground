"""Shared Gemini plumbing: the client, the model fallback loop, retries and error handling.

Check my work and the page reader both use it. Callers raise their own GeminiError subclass, whose
message is always safe to show the student.
"""
import asyncio
import logging
import os
import re
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import TypeVar

from dotenv import load_dotenv
from google import genai
from google.genai import errors, types
from pydantic import BaseModel

log = logging.getLogger("learning_grounds.gemini")

API_DIR = Path(__file__).resolve().parent
load_dotenv(API_DIR / ".env")
# Each model has its own daily free-tier quota, so a later one covers a limit on an earlier one.
# Lite goes first because it answered in 1-2 s, against 5-8 s for gemini-3.6-flash, with the same
# results on scripts/eval_check_work.py. gemini-3.8-flash is out: its free tier allows 20 requests a day.
MODELS = tuple(os.environ.get("GEMINI_MODELS", "gemini-3.5-flash-lite,gemini-3.6-flash,gemini-3.5-flash").split(","))
RETRYABLE_CODES = {429, 500, 503, 504}
# Codes that mean "busy, try again soon". Only these earn a backoff round; a timeout or a bad
# answer moves on to the next model straight away.
BUSY_CODES = {429, 503}
# Google rejects a timeout under 10 s.
MIN_TIMEOUT_MS = 10_000

T = TypeVar("T")
M = TypeVar("M", bound=BaseModel)

# Patched in tests so backoff doesn't slow them down.
_sleep = asyncio.sleep


class GeminiError(Exception):
    """Gemini couldn't produce a result. The message is safe to show the student."""


def make_client(feature: str, timeout_ms: int, error: type[GeminiError] = GeminiError) -> genai.Client:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise error(f"{feature} isn't set up: GEMINI_API_KEY is missing on the server.")
    timeout = max(timeout_ms, MIN_TIMEOUT_MS)
    return genai.Client(api_key=key, http_options=types.HttpOptions(timeout=timeout))


async def generate_json(
    client: genai.Client, model: str, parts: list, system_instruction: str, schema: type[M]
) -> M | None:
    """One structured call. Returns None when the answer doesn't match the schema."""
    response = await client.aio.models.generate_content(
        model=model,
        contents=parts,
        config=types.GenerateContentConfig(
            system_instruction=system_instruction,
            response_mime_type="application/json",
            response_schema=schema,
        ),
    )
    return response.parsed if isinstance(response.parsed, schema) else None


def retry_delay_s(error: errors.APIError) -> float | None:
    """The wait Google suggests in a 429's RetryInfo, such as "37s", if there is one."""
    details = error.details.get("error", {}).get("details", []) if isinstance(error.details, dict) else []
    for detail in details if isinstance(details, list) else []:
        if isinstance(detail, dict) and str(detail.get("@type", "")).endswith("RetryInfo"):
            match = re.fullmatch(r"(\d+(?:\.\d+)?)s", str(detail.get("retryDelay", "")))
            if match:
                return float(match.group(1))
    return None


async def with_fallback(
    attempt: Callable[[str], Awaitable[T | None]],
    *,
    what: str,
    error: type[GeminiError],
    failed_message: str,
    busy_message: str,
    backoff_s: tuple[float, ...] = (),
    max_wait_s: float = 15.0,
    deadline_s: float | None = None,
) -> T:
    """Tries each model in MODELS until one answers.

    `attempt(model)` makes the call and returns None for an answer that doesn't fit the schema.
    When every model was busy (429 or 503), it waits backoff_s[n] and tries them all again, up to
    len(backoff_s) more rounds. A RetryInfo delay from Google lengthens the wait, and a wait longer
    than max_wait_s, or one that would pass deadline_s, ends the retries: that's usually a daily quota.
    """
    started = time.perf_counter()
    for round_number in range(len(backoff_s) + 1):
        busy = False
        suggested: float | None = None
        for model in MODELS:
            call_started = time.perf_counter()
            try:
                result = await attempt(model)
            except errors.APIError as api_error:
                # Only the code is logged: the response text could echo request details.
                log.warning("%s: %s failed with code %s", what, model, api_error.code)
                if api_error.code in BUSY_CODES:
                    busy = True
                    delay = retry_delay_s(api_error)
                    if delay is not None:
                        suggested = delay if suggested is None else min(suggested, delay)
                if api_error.code in RETRYABLE_CODES:
                    continue
                raise error(failed_message) from api_error
            except Exception as other:
                # Timeouts and network failures arrive as the SDK's own HTTP library types, which can
                # change between versions. A failure here should never crash the request.
                log.warning("%s: %s couldn't be reached: %s", what, model, type(other).__name__)
                continue
            if result is None:
                log.warning("%s: %s returned a result that didn't match the schema", what, model)
                continue
            log.info("%s: %s answered in %.1f s", what, model, time.perf_counter() - call_started)
            return result
        if not busy or round_number == len(backoff_s):
            break
        wait = max(backoff_s[round_number], suggested or 0.0)
        elapsed = time.perf_counter() - started
        if wait > max_wait_s or (deadline_s is not None and elapsed + wait > deadline_s):
            log.warning("%s: every model is busy and the suggested wait is %.0f s, so giving up", what, wait)
            break
        log.info("%s: every model is busy, retrying in %.1f s", what, wait)
        await _sleep(wait)
    raise error(busy_message)
