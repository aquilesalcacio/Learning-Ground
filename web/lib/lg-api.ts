"use client";

import { getAccessToken } from "@auth0/nextjs-auth0";
import { LG_API_URL } from "./lg-document";

export class LgApiAuthError extends Error {
  name = "LgApiAuthError";
}

// Every call to our FastAPI goes through here, so each one carries the student's Auth0 access token.
// Errors other than a lost session surface as fetch's own errors, as before.
export async function lgApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let token: string;
  try {
    token = await getAccessToken();
  } catch {
    // The session ended. A reload lets the proxy send the student back to login.
    throw new LgApiAuthError("Your session has expired. Please reload the page to log in again.");
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${LG_API_URL}${path}`, { ...init, headers });
}
