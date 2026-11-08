import { type NextRequest, NextResponse } from "next/server";
import { auth0 } from "./lib/auth0";

// Auth0 mounts /auth/login, /auth/logout, /auth/callback, /auth/profile and /auth/access-token here,
// and keeps the session rolling. Every other page needs a logged-in student.
export async function proxy(request: NextRequest) {
  const authResponse = await auth0.middleware(request);
  if (request.nextUrl.pathname.startsWith("/auth")) return authResponse;

  const session = await auth0.getSession(request);
  if (!session) {
    const login = new URL("/auth/login", request.nextUrl.origin);
    login.searchParams.set("returnTo", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }
  return authResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|webp|ico|mjs|wasm)$).*)"],
};
