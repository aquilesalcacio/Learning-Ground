# Deploying Learning Grounds

Learning Grounds runs as two Docker services on our Hostinger VPS with Easypanel. Both are built from the `main` branch on GitHub. Replace `<domain>` with our GoDaddy domain everywhere below.

| Service | Folder | Port | Address |
|---|---|---|---|
| `web` (Next.js) | `web/` | 3000 | `https://<domain>` and `https://www.<domain>` |
| `api` (FastAPI) | `api/` | 8000 | `https://api.<domain>` |

Work in this order: DNS first (it takes a while to spread), then the API, then the web app, then the outside services.

## 1. DNS at GoDaddy

In GoDaddy, open **My Products → `<domain>` → DNS**, and set these records. The VPS IP is on the Hostinger VPS overview page.

| Type | Name | Value | Note |
|---|---|---|---|
| A | `@` | VPS IP | Replace GoDaddy's parked A record |
| A | `api` | VPS IP | |
| CNAME | `www` | `@` | GoDaddy usually has this already |

Easypanel can only get HTTPS certificates once these resolve. Check with `dig +short <domain>` and `dig +short api.<domain>`: both should print the VPS IP.

## 2. The API service

In Easypanel, create a project (`learning-grounds`), then **+ Service → App**, named `api`.

- **Source:** GitHub, repository `aquilesalcacio/Learning-Ground`, branch `main`, build path `/api`.
- **Build:** Dockerfile, file `Dockerfile`.
- **Mounts:** add a volume mounted at `/app/data`. Canvas LMS connections are saved there, so they survive redeploys.
- **Domains:** `api.<domain>`, HTTPS on, proxy port `8000`.
- **Environment:**

```bash
ELEVENLABS_API_KEY=...
ELEVENLABS_AGENT_ID=...       # as in api/.env
GEMINI_API_KEY=...            # a paid key: the free tier allows 20 requests a day
AUTH0_DOMAIN=...              # as in api/.env
AUTH0_AUDIENCE=https://api.learning-grounds.dev
WEB_ORIGINS=https://<domain>,https://www.<domain>
WEB_BASE_URL=https://<domain>
CANVAS_LMS_BASE_URL=...       # as in api/.env
CANVAS_LMS_CLIENT_ID=...
CANVAS_LMS_CLIENT_SECRET=...
CANVAS_LMS_REDIRECT_URI=https://api.<domain>/canvas-lms/callback
CANVAS_LMS_STATE_SECRET=...   # openssl rand -hex 32
LTI_CONSUMER_KEY=learning-grounds
LTI_SHARED_SECRET=...         # as in api/.env, or a new one pasted into Canvas LMS again
LTI_LAUNCH_URL=https://api.<domain>/lti/launch
```

Never set `AUTH_DISABLED` on the server. Copy the values marked `...` from `api/.env`.

Deploy, then open `https://api.<domain>/health`. It should show `{"status":"ok"}`.

## 3. The web service

**+ Service → App**, named `web`.

- **Source:** the same repository and branch, build path `/web`.
- **Build:** Dockerfile, file `Dockerfile`.
- **Domains:** `<domain>` and `www.<domain>`, HTTPS on, proxy port `3000`.
- **Environment:**

```bash
AUTH0_DOMAIN=...              # as in web/.env.local
AUTH0_CLIENT_ID=...
AUTH0_CLIENT_SECRET=...
AUTH0_SECRET=...              # a new one for production: openssl rand -hex 32
AUTH0_AUDIENCE=https://api.learning-grounds.dev
APP_BASE_URL=https://<domain>
NEXT_PUBLIC_API_URL=https://api.<domain>
NEXT_PUBLIC_TLDRAW_LICENSE_KEY=...
```

The two `NEXT_PUBLIC_` values are written into the browser code when the image is built, so the build needs them, not only the running server. The Dockerfile reads them as build arguments. If the build stops with "Set NEXT_PUBLIC_API_URL as a build argument", the environment didn't reach the build: add both values as build arguments in the service's build settings and deploy again. Changing either one later also needs a new build.

## 4. Outside services

**Auth0** (Applications → Learning Grounds → Settings):

| Field | Add |
|---|---|
| Allowed Callback URLs | `https://<domain>/auth/callback`, `https://www.<domain>/auth/callback` |
| Allowed Logout URLs | `https://<domain>`, `https://www.<domain>` |
| Allowed Web Origins | `https://<domain>`, `https://www.<domain>` |

Keep the localhost entries, so local development still works.

**Canvas LMS** (our instance, as admin):

- **Admin → Developer Keys →** our API key: add `https://api.<domain>/canvas-lms/callback` to its Redirect URIs.
- **The LTI app:** in each course that uses it, edit or re-add the app from `https://api.<domain>/lti/config.xml`, with the same consumer key and shared secret as the API's environment.

**tldraw:** the license key must allow `<domain>`. Without a key, the board shows tldraw's licence notice.

**ElevenLabs:** once the deployed web app works, require auth on the agent, so its ID alone can't start a session and spend our minutes:

```bash
cd api && uv run scripts/elevenlabs_setup.py agent --auth
```

From then on, every web build talking to the agent must be one that gets credentials from `POST /voice/session`: `main` from Nov 8 onward.

## 5. Check the live site

1. Open `https://<domain>`. It sends you to log in, then back to the start screen.
2. Upload a homework PDF. Its pages appear and are read one by one.
3. Start a voice session and ask the tutor to circle problem 3. The pen draws as it talks.
4. Write on the problem and ask the tutor to check your work.
5. In a new chat, ask for a practice problem. The tutor writes a question with an answer box; answer in it and wait.
6. On the Student Profile, connect Canvas LMS, then open an assignment from Canvas LMS.

## Redeploying

Push to `main`, then press **Deploy** on the service in Easypanel, or turn on its auto-deploy. Run `uv run scripts/elevenlabs_setup.py agent --auth` from `api/` again after changing `api/voice/tools.json`, and deploy the web app at the same time.
