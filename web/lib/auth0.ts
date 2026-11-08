import { Auth0Client } from "@auth0/nextjs-auth0/server";

// Reads AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET and APP_BASE_URL from the env.
// The audience makes Auth0 issue an access token for our FastAPI, which checks it in api/auth.py.
export const auth0 = new Auth0Client({
  authorizationParameters: {
    audience: process.env.AUTH0_AUDIENCE,
    scope: "openid profile email offline_access",
  },
});
