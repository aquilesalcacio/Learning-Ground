"""FastAPI backend for Learning Grounds.

    uv run uvicorn main:app --reload --port 8000

Run from api/. Reads its keys from api/.env.
"""
import logging
import os
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from check_work import CheckWorkError, Language, WorkCheck, check_work

logging.basicConfig(level=logging.INFO)

MAX_IMAGE_BYTES = 5 * 1024 * 1024
DEFAULT_WEB_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000"
IMAGE_SIGNATURES = {b"\x89PNG\r\n\x1a\n": "image/png", b"\xff\xd8\xff": "image/jpeg"}

app = FastAPI(title="Learning Grounds API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("WEB_ORIGINS", DEFAULT_WEB_ORIGINS).split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def image_mime_type(data: bytes) -> str | None:
    # Checks the bytes, because the declared content type comes from the client.
    return next((mime for signature, mime in IMAGE_SIGNATURES.items() if data.startswith(signature)), None)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/check-work")
async def post_check_work(
    image: Annotated[UploadFile, File()],
    language: Annotated[Language, Form()] = "en",
    label: Annotated[str, Form(max_length=80)] = "",
) -> WorkCheck:
    data = await image.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "The snapshot is larger than 5 MB.")
    mime_type = image_mime_type(data)
    if not mime_type:
        raise HTTPException(415, "The snapshot must be a PNG or JPEG image.")
    try:
        return await check_work(data, mime_type, language, label)
    except CheckWorkError as error:
        raise HTTPException(502, str(error)) from error
