"use client";

import { LG_API_URL } from "./lg-document";

const GUEST_KEY = "lg-guest-id";
const GUEST_ID = /^[0-9a-f]{32}$/;
let guestIdInMemory: string | null = null;

// There's no login. Each browser makes a random guest ID once and keeps it, and the API files that
// browser's Canvas LMS data (calendar feed, course launches, turn-ins) under it (api/auth.py).
// Where storage is blocked, the ID lasts until the page is closed.
function guestId(): string {
  if (guestIdInMemory) return guestIdInMemory;
  let id: string | null = null;
  try {
    id = localStorage.getItem(GUEST_KEY);
  } catch {}
  if (!id || !GUEST_ID.test(id)) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    try {
      localStorage.setItem(GUEST_KEY, id);
    } catch {}
  }
  guestIdInMemory = id;
  return id;
}

// Every call to our FastAPI goes through here, so each one carries this browser's guest ID.
export async function lgApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("X-Guest-Id", guestId());
  return fetch(`${LG_API_URL}${path}`, { ...init, headers });
}
