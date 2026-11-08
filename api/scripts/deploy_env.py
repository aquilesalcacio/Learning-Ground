"""Print a service's environment file for the server (docs/DEPLOY.md), straight into place over SSH:

    uv run scripts/deploy_env.py api example.com | ssh root@SERVER 'cat > /opt/learning-grounds/deploy/.env.api'
    uv run scripts/deploy_env.py web example.com --tldraw-key KEY | ssh root@SERVER 'cat > /opt/learning-grounds/deploy/.env.web'

Run from api/. Keys come from api/.env and web/.env.local, and every address comes from the domain, so
nothing local (localhost URLs, AUTH_DISABLED) reaches the server. The output holds secrets: send it to
the server (or pbcopy), and never commit it or paste it into a chat.
"""
import argparse
import re
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUDIENCE = "https://api.learning-grounds.dev"
CANVAS_LMS_OAUTH = ("CANVAS_LMS_BASE_URL", "CANVAS_LMS_CLIENT_ID", "CANVAS_LMS_CLIENT_SECRET")


def read_env(path: Path) -> dict[str, str]:
    if not path.exists():
        sys.exit(f"{path} is missing.")
    values = {}
    for line in path.read_text().splitlines():
        match = re.match(r"\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$", line)
        if match:
            value = match[2].strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[match[1]] = value
    return values


def domain_name(raw: str) -> str:
    domain = re.sub(r"^https?://", "", raw.strip().lower()).strip("/")
    domain = domain.removeprefix("www.")
    if not re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)+", domain):
        sys.exit(f"{raw!r} doesn't look like a domain, such as example.com.")
    return domain


def take(env: dict[str, str], name: str, source: str, missing: list[str]) -> str:
    value = env.get(name, "").strip()
    if not value:
        missing.append(f"{name} (in {source})")
    return value


def api_block(domain: str, env: dict[str, str]) -> tuple[list[str], list[str]]:
    missing: list[str] = []
    lines = [
        f"ELEVENLABS_API_KEY={take(env, 'ELEVENLABS_API_KEY', 'api/.env', missing)}",
        f"ELEVENLABS_AGENT_ID={take(env, 'ELEVENLABS_AGENT_ID', 'api/.env', missing)}",
        f"GEMINI_API_KEY={take(env, 'GEMINI_API_KEY', 'api/.env', missing)}",
        f"AUTH0_DOMAIN={take(env, 'AUTH0_DOMAIN', 'api/.env', missing)}",
        f"AUTH0_AUDIENCE={env.get('AUTH0_AUDIENCE') or AUDIENCE}",
        f"WEB_ORIGINS=https://{domain},https://www.{domain}",
        f"WEB_BASE_URL=https://{domain}",
        f"LTI_CONSUMER_KEY={env.get('LTI_CONSUMER_KEY') or 'learning-grounds'}",
        f"LTI_SHARED_SECRET={take(env, 'LTI_SHARED_SECRET', 'api/.env', missing)}",
        f"LTI_LAUNCH_URL=https://api.{domain}/lti/launch",
    ]
    # Canvas LMS OAuth only works on a school instance with a Developer Key, not on Canvas Lite.
    if all(env.get(name, "").strip() for name in CANVAS_LMS_OAUTH):
        lines += [f"{name}={env[name].strip()}" for name in CANVAS_LMS_OAUTH]
        lines += [
            f"CANVAS_LMS_REDIRECT_URI=https://api.{domain}/canvas-lms/callback",
            f"CANVAS_LMS_STATE_SECRET={env.get('CANVAS_LMS_STATE_SECRET') or secrets.token_hex(32)}",
        ]
    return lines, missing


def web_block(domain: str, env: dict[str, str], tldraw_key: str) -> tuple[list[str], list[str]]:
    missing: list[str] = []
    lines = [
        f"AUTH0_DOMAIN={take(env, 'AUTH0_DOMAIN', 'web/.env.local', missing)}",
        f"AUTH0_CLIENT_ID={take(env, 'AUTH0_CLIENT_ID', 'web/.env.local', missing)}",
        f"AUTH0_CLIENT_SECRET={take(env, 'AUTH0_CLIENT_SECRET', 'web/.env.local', missing)}",
        # A new one for production, so a local session cookie never works on the live site.
        f"AUTH0_SECRET={secrets.token_hex(32)}",
        f"AUTH0_AUDIENCE={env.get('AUTH0_AUDIENCE') or AUDIENCE}",
        # Both addresses, so logging in from www. comes back to www.
        f"APP_BASE_URL=https://{domain},https://www.{domain}",
        f"NEXT_PUBLIC_API_URL=https://api.{domain}",
    ]
    key = tldraw_key.strip() or env.get("NEXT_PUBLIC_TLDRAW_LICENSE_KEY", "").strip()
    if key:
        lines.append(f"NEXT_PUBLIC_TLDRAW_LICENSE_KEY={key}")
    else:
        missing.append("the tldraw license key (pass --tldraw-key)")
    return lines, missing


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("service", choices=["api", "web"])
    parser.add_argument("domain", help="our domain, such as example.com")
    parser.add_argument("--tldraw-key", default="", help="web only: tldraw's license key")
    parser.add_argument("--api-env", type=Path, default=ROOT / "api" / ".env")
    parser.add_argument("--web-env", type=Path, default=ROOT / "web" / ".env.local")
    args = parser.parse_args()

    domain = domain_name(args.domain)
    if args.service == "api":
        lines, missing = api_block(domain, read_env(args.api_env))
    else:
        lines, missing = web_block(domain, read_env(args.web_env), args.tldraw_key)
    if missing:
        sys.exit("Not printed. Still missing: " + ", ".join(missing) + ".")
    print("\n".join(lines))
    print(f"Ready: {len(lines)} values for the {args.service} service on {domain}.", file=sys.stderr)


if __name__ == "__main__":
    main()
