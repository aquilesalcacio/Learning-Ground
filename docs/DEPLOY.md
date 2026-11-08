# Deploying Learning Grounds

Learning Grounds runs on our Hostinger VPS (`187.77.50.15`), next to tagmephotos.com.br. It is two Docker containers built from the `main` branch. Our domain is `learningrounds.com`; `<domain>` below means it.

| Service | Folder | On tagme's network | Address |
|---|---|---|---|
| `web` (Next.js) | `web/` | `lg-web:3000` | `https://<domain>` and `https://www.<domain>` |
| `api` (FastAPI) | `api/` | `lg-api:8000` | `https://api.<domain>` |

tagmephotos's nginx (container `tagme-nginx-1`, set up in `/srv/tagme`) owns ports 80 and 443. Our containers join its Docker network, `tagme_default`, and our three sites sit in its config file between marker lines. The server's own nginx package isn't running; leave it off. Our containers also listen on `127.0.0.1:3100` and `127.0.0.1:8100`, for health checks. The files are in `deploy/`: `compose.yaml`, `deploy.sh`, `nginx.conf` and `nginx_site.py`.

Work in this order: DNS first (it takes a while to spread), then the server, then the outside services.

## 1. DNS at GoDaddy

In GoDaddy, open **My Products → `<domain>` → DNS**, and set these records:

| Type | Name | Value | Note |
|---|---|---|---|
| A | `@` | `187.77.50.15` | Replace GoDaddy's parked A record |
| A | `api` | `187.77.50.15` | |
| CNAME | `www` | `@` | GoDaddy usually has this already |

Turn off any domain forwarding on the domain, since it overrides these records. HTTPS certificates can only be issued once these resolve. Check with `dig +short <domain> api.<domain>`: each should print the VPS IP.

## 2. The server, once

In a root shell on the VPS (hPanel's Browser terminal, or `ssh root@187.77.50.15`):

```bash
git clone https://github.com/aquilesalcacio/Learning-Ground.git /opt/learning-grounds
```

Docker and certbot are already on the server for tagmephotos. Don't reinstall Docker: the installer can restart it, and tagmephotos with it.

## 3. The environment files

From the laptop, send each service's settings straight to the server. The keys come from `api/.env` and `web/.env.local`, and the addresses from the domain, so nothing local (localhost URLs, `AUTH_DISABLED`) reaches the server. Each command asks for the root password.

```bash
cd api
uv run scripts/deploy_env.py api <domain> | ssh root@187.77.50.15 'umask 077; cat > /opt/learning-grounds/deploy/.env.api'
uv run scripts/deploy_env.py web <domain> --tldraw-key <key> | ssh root@187.77.50.15 'umask 077; cat > /opt/learning-grounds/deploy/.env.web'
```

`.env.api` holds `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `GEMINI_API_KEY`, `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `WEB_ORIGINS`, `WEB_BASE_URL` and the three `LTI_*` values. `.env.web` holds the Auth0 app's values with a new `AUTH0_SECRET`, `APP_BASE_URL` with both addresses (so Auth0 returns a student to the one they started on), `NEXT_PUBLIC_API_URL` and the tldraw key.

The `CANVAS_LMS_*` OAuth values are only for a school's Canvas LMS instance with a Developer Key. Canvas Lite has none, so we leave them out, and the Student Profile hides its Connect button. Never set `AUTH_DISABLED` on the server.

## 4. Build and start

On the server:

```bash
/opt/learning-grounds/deploy/deploy.sh
```

It pulls `main`, builds both images, starts them and waits until both answer. The first build takes several minutes. The `NEXT_PUBLIC_` values are written into the browser code when the web image is built, so changing either one needs this again.

## 5. nginx and HTTPS

On the server, after DNS resolves. First the certificate: tagme's nginx already answers Let's Encrypt's checks for any name from `/var/www/certbot`, so this needs no nginx change. Certbot renews it with tagmephotos's certificate.

```bash
certbot certonly --webroot -w /var/www/certbot -d <domain> -d www.<domain> -d api.<domain>
```

Then add our sites to tagme's nginx:

```bash
python3 /opt/learning-grounds/deploy/nginx_site.py install <domain>
```

The script puts `deploy/nginx.conf` into `/srv/tagme/nginx/nginx.conf` between marker lines, and keeps the file as it was before as `nginx.conf.before-learning-grounds`. It tests the whole config inside the container, and reloads nginx only if the test passes. Otherwise it puts the old file back, so tagmephotos keeps running as before. Run it again after changing `deploy/nginx.conf`, and use `nginx_site.py remove` to take our sites out. Since the change is in tagme's folder, keep it in mind when changing tagmephotos's nginx file.

Then open `https://api.<domain>/health`. It should show `{"status":"ok"}`.

## 6. Outside services

**Auth0** (Applications → Learning Grounds → Settings):

| Field | Add |
|---|---|
| Allowed Callback URLs | `https://<domain>/auth/callback`, `https://www.<domain>/auth/callback` |
| Allowed Logout URLs | `https://<domain>`, `https://www.<domain>` |
| Allowed Web Origins | `https://<domain>`, `https://www.<domain>` |

Keep the localhost entries, so local development still works.

**Canvas LMS** (Canvas Lite, course "Sharkbyte test"): in **Settings → Apps → View App Configurations**, delete the old Learning Grounds app, then **+ App** with:

- **Configuration Type:** By URL
- **Name:** Learning Grounds
- **Consumer Key:** `learning-grounds`
- **Shared Secret:** `LTI_SHARED_SECRET` from `api/.env`
- **Config URL:** `https://api.<domain>/lti/config.xml`

On a school instance with OAuth set up, also add `https://api.<domain>/canvas-lms/callback` to the Developer Key's Redirect URIs.

**tldraw:** the license key must allow `<domain>`. Without a key, the board shows tldraw's licence notice.

**ElevenLabs:** require auth on the agent, so its ID alone can't start a session and spend our minutes:

```bash
cd api && uv run scripts/elevenlabs_setup.py agent --auth
```

From then on, every web build talking to the agent must be one that gets credentials from `POST /voice/session`: `main` from Nov 8 onward. Anyone running an older local copy needs to pull `main` first.

**Gemini:** turn on billing for the key's project in Google AI Studio. The free tier allows 20 requests a day.

## 7. Check the live site

1. Open `https://<domain>`. It sends you to log in, then back to the start screen.
2. Upload a homework PDF. Its pages appear and are read one by one.
3. Start a voice session and ask the tutor to circle problem 3. The pen draws as it talks.
4. Write on the problem and ask the tutor to check your work.
5. In a new chat, ask for a practice problem. The tutor writes a question with an answer box; answer in it and wait.
6. In Canvas Lite, open Learning Grounds from the course menu. It opens in a new tab, and the Student Profile shows the course.

## Redeploying

Push to `main`, then run `ssh root@187.77.50.15 /opt/learning-grounds/deploy/deploy.sh`. Run `uv run scripts/elevenlabs_setup.py agent --auth` from `api/` again after changing `api/voice/tools.json`, and redeploy at the same time.

## When something goes wrong

- **Container logs:** `docker compose -f /opt/learning-grounds/deploy/compose.yaml logs --tail 100 web` (or `api`).
- **The web build is killed (exit code 137):** the server ran out of memory. Add swap once, then deploy again: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab`.
- **502 Bad Gateway:** the container for that address isn't running. Check the logs, then run `deploy.sh` again.
- **Take Learning Grounds offline** without touching anything else: `python3 /opt/learning-grounds/deploy/nginx_site.py remove`, then `docker compose -f /opt/learning-grounds/deploy/compose.yaml down`.
