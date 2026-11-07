"""Set up the ElevenLabs agent and the voice catalog for Learning Grounds tutors.

One agent becomes any tutor: each session overrides its prompt, language, voice, stability and speed.

    uv run scripts/elevenlabs_setup.py voices pt       # list voices and write a page to listen to them
    uv run scripts/elevenlabs_setup.py add pt 2 5 7    # add those numbered voices to the catalog
    uv run scripts/elevenlabs_setup.py agent           # create or update the agent and its tools
    uv run scripts/elevenlabs_setup.py agent --auth    # same, with token auth required (T-203)

Run from api/. Reads ELEVENLABS_API_KEY from api/.env.
"""
import argparse
import html
import json
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

API_DIR = Path(__file__).resolve().parents[1]
VOICE_DIR = API_DIR / "voice"
CATALOG = VOICE_DIR / "voice_catalog.json"
WEB_CATALOG = API_DIR.parent / "web" / "lib" / "voice-catalog.json"
TOOLS = VOICE_DIR / "tools.json"
BASE_URL = "https://api.elevenlabs.io"

AGENT_NAME = "Learning Grounds Tutor"
LLM = "gemini-3.8-flash"
REASONING_EFFORT = "low"
# Expressive real-time model for all three languages. It reads audio tags such as [laughs]
# and turns expressive mode on. To roll back, set eleven_flash_v2 and run `agent` again.
TTS_MODEL = "eleven_v4_turbo"
LANGUAGES = ("pt", "es", "en")
PRIMARY_LANGUAGE = "en"

# The student speaks first. An empty first message makes the agent wait (plan step A).
FIRST_MESSAGE = ""
# Seconds of silence before the agent takes a turn. 30 is the documented maximum, and the
# prompt then tells it to call skip_turn and stay quiet.
TURN_TIMEOUT = 30
# A whole tutoring session. The ElevenLabs default of 600 would cut one off.
MAX_DURATION_SECONDS = 1800

# Fallback only. Every web session replaces it with web/lib/lg-tutor-prompt.ts, which holds the
# persona, profile, homework regions and the locked core with the tool rules.
BASE_PROMPT = """You are a patient math tutor helping a student with their homework, out loud, on a shared board.

- The student speaks first. If they're quiet or thinking, stay silent and call skip_turn. Never prompt them.
- Guide the student. Never give a final answer before the student has tried. If they insist, show only the next single step.
- Speak math in words, such as "x squared". Never read symbols or code aloud.
- Keep spoken turns short.
- No homework regions have been shared with you, so don't use the board tools, and never say you've marked anything.
"""


def client() -> httpx.Client:
    load_dotenv(API_DIR / ".env")
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not key:
        sys.exit("ELEVENLABS_API_KEY is missing. Copy api/.env.example to api/.env and add your key.")
    return httpx.Client(base_url=BASE_URL, headers={"xi-api-key": key}, timeout=30)


def checked(response: httpx.Response) -> dict:
    if response.is_error:
        sys.exit(f"ElevenLabs returned {response.status_code} for {response.request.url.path}:\n{response.text}")
    return response.json()


def load_catalog() -> dict:
    return json.loads(CATALOG.read_text(encoding="utf-8"))


def save_catalog(catalog: dict) -> None:
    content = json.dumps(catalog, indent=2, ensure_ascii=False) + "\n"
    CATALOG.write_text(content, encoding="utf-8")
    # The tutor editor reads this copy until GET /voices exists (T-305).
    WEB_CATALOG.write_text(content, encoding="utf-8")


def candidates_path(language: str) -> Path:
    return VOICE_DIR / f"candidates_{language}.json"


def write_listening_page(language: str, voices: list[dict]) -> Path:
    rows = []
    for number, voice in enumerate(voices, 1):
        description = " · ".join(filter(None, [voice.get("gender"), voice.get("age"), voice.get("accent"), voice.get("locale")]))
        rows.append(
            f"<tr><td>{number}</td><td><strong>{html.escape(voice.get('name') or '')}</strong><br>"
            f"<small>{html.escape(description)}</small></td>"
            f"<td><audio controls preload='none' src='{html.escape(voice.get('preview_url') or '', quote=True)}'></audio></td></tr>"
        )
    page = VOICE_DIR / f"candidates_{language}.html"
    page.write_text(
        f"<!doctype html><meta charset='utf-8'><title>Voices: {language}</title>"
        "<style>body{font:15px Arial;margin:32px}td{padding:8px 16px 8px 0;border-bottom:1px solid #ddd}</style>"
        f"<h1>Voices: {language}</h1><p>Add your picks with: <code>uv run scripts/elevenlabs_setup.py add {language} 2 5 7</code></p>"
        f"<table>{''.join(rows)}</table>",
        encoding="utf-8",
    )
    return page


def cmd_voices(args: argparse.Namespace) -> None:
    params = {"language": args.language, "page_size": args.limit, "use_cases": "conversational"}
    if args.locale:
        params["locale"] = args.locale
    if args.gender:
        params["gender"] = args.gender
    with client() as http:
        voices = checked(http.get("/v1/shared-voices", params=params)).get("voices", [])
    # ElevenLabs rejects live-moderated voices on agents.
    voices = [voice for voice in voices if not voice.get("live_moderation_enabled")]
    if not voices:
        sys.exit("No voices matched. Try again without --locale or --gender.")
    candidates_path(args.language).write_text(json.dumps(voices, indent=2, ensure_ascii=False), encoding="utf-8")
    for number, voice in enumerate(voices, 1):
        surcharge = "  (costs extra)" if voice.get("fiat_rate") else ""
        print(f"{number:>3}  {voice.get('name', '')[:34]:<34} {voice.get('gender', ''):<8} {voice.get('accent', ''):<16} {voice.get('locale') or '':<7}{surcharge}")
    print(f"\nListen here: {write_listening_page(args.language, voices)}")


def cmd_add(args: argparse.Namespace) -> None:
    path = candidates_path(args.language)
    if not path.exists():
        sys.exit(f"Run 'voices {args.language}' first.")
    voices = json.loads(path.read_text(encoding="utf-8"))
    catalog = load_catalog()
    with client() as http:
        for number in args.numbers:
            if not 1 <= number <= len(voices):
                sys.exit(f"{number} isn't on the list of {len(voices)} voices.")
            voice = voices[number - 1]
            added = checked(http.post(
                f"/v1/voices/add/{voice['public_owner_id']}/{voice['voice_id']}",
                json={"new_name": voice["name"]},
            ))
            entry = {
                "voice_id": added["voice_id"],
                "name": voice["name"],
                "gender": voice.get("gender"),
                "accent": voice.get("accent"),
                "locale": voice.get("locale"),
                "preview_url": voice.get("preview_url"),
            }
            catalog[args.language] = [v for v in catalog[args.language] if v["voice_id"] != entry["voice_id"]] + [entry]
            # Saved per voice, so a plan limit partway through doesn't lose the earlier ones.
            save_catalog(catalog)
            print(f"Added {voice['name']} to {args.language}: {entry['voice_id']}")


def enabled_tools() -> list[dict]:
    return [tool["tool_config"] for tool in json.loads(TOOLS.read_text(encoding="utf-8")) if tool["enabled"]]


def sync_tools(http: httpx.Client) -> list[str]:
    existing = {t["tool_config"]["name"]: t["id"] for t in checked(http.get("/v1/convai/tools")).get("tools", [])}
    ids = []
    for config in enabled_tools():
        body = {"tool_config": config}
        if config["name"] in existing:
            tool_id = checked(http.patch(f"/v1/convai/tools/{existing[config['name']]}", json=body))["id"]
        else:
            tool_id = checked(http.post("/v1/convai/tools", json=body))["id"]
        print(f"Tool ready: {config['name']}")
        ids.append(tool_id)
    return ids


# A built-in system tool: the agent ends its turn without speaking.
SKIP_TURN = {
    "type": "system",
    "name": "skip_turn",
    "description": "Stay silent and let the student keep thinking. Use it whenever the student is quiet, thinking or working, or hasn't spoken yet.",
    # The default, auto, can add a spoken line before the tool runs, which would defeat it.
    "pre_tool_speech": "off",
    # -1: after skipping, wait silently until the student speaks, with no check-in.
    "params": {"system_tool_type": "skip_turn", "wait_timeout_secs": -1},
}


def agent_body(tool_ids: list[str], catalog: dict, require_auth: bool) -> dict:
    presets = {}
    for language in LANGUAGES:
        if language == PRIMARY_LANGUAGE:
            continue
        # A preset only picks that language's default voice. Its first message is cleared
        # explicitly, because an update keeps fields it isn't sent. No model here, so the
        # agent's model and each session's voice settings apply in every language.
        overrides = {"agent": {"first_message": None}}
        if catalog[language]:
            overrides["tts"] = {"voice_id": catalog[language][0]["voice_id"]}
        presets[language] = {"overrides": overrides}

    tts = {"model_id": TTS_MODEL, "expressive_mode": True}
    if catalog[PRIMARY_LANGUAGE]:
        tts["voice_id"] = catalog[PRIMARY_LANGUAGE][0]["voice_id"]

    return {
        "name": AGENT_NAME,
        "conversation_config": {
            "agent": {
                "language": PRIMARY_LANGUAGE,
                "first_message": FIRST_MESSAGE,
                "prompt": {
                    "prompt": BASE_PROMPT,
                    "llm": LLM,
                    "reasoning_effort": REASONING_EFFORT,
                    "tool_ids": tool_ids,
                    "built_in_tools": {"skip_turn": SKIP_TURN},
                },
            },
            "tts": tts,
            # Students pause while they work, so the agent waits longer before it answers.
            "turn": {"turn_timeout": TURN_TIMEOUT, "turn_eagerness": "patient"},
            "conversation": {"max_duration_seconds": MAX_DURATION_SECONDS},
            "language_presets": presets,
        },
        "platform_settings": {
            "auth": {"enable_auth": require_auth},
            # Off by default. Without these, sending a per-tutor override makes the session fail,
            # so run `agent` before shipping web code that sends a new one.
            "overrides": {
                "conversation_config_override": {
                    "agent": {"first_message": True, "language": True, "prompt": {"prompt": True}},
                    # Each tutor's tone sets stability and speed (lg-tutor-prompt.ts).
                    "tts": {"voice_id": True, "stability": True, "speed": True},
                    "conversation": {"text_only": True},
                }
            },
        },
    }


def cmd_agent(args: argparse.Namespace) -> None:
    catalog = load_catalog()
    if args.dry_run:
        print(json.dumps(agent_body(["<tool id>"] * len(enabled_tools()), catalog, args.auth), indent=2, ensure_ascii=False))
        return
    missing = [language for language in LANGUAGES if not catalog[language]]
    if missing:
        print(f"Note: no voices in the catalog yet for {', '.join(missing)}. ElevenLabs defaults will be used there.")
    with client() as http:
        body = agent_body(sync_tools(http), catalog, args.auth)
        found = checked(http.get("/v1/convai/agents", params={"search": AGENT_NAME})).get("agents", [])
        match = next((agent["agent_id"] for agent in found if agent.get("name") == AGENT_NAME), None)
        if match:
            agent_id = checked(http.patch(f"/v1/convai/agents/{match}", json=body))["agent_id"]
            print(f"Updated agent {agent_id}")
        else:
            agent_id = checked(http.post("/v1/convai/agents/create", json=body))["agent_id"]
            print(f"Created agent {agent_id}")
    print(f"\nAdd to api/.env:          ELEVENLABS_AGENT_ID={agent_id}")
    print(f"Add to web/.env.local:    NEXT_PUBLIC_ELEVENLABS_AGENT_ID={agent_id}   (G1 test only)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)

    voices = commands.add_parser("voices", help="list library voices for a language")
    voices.add_argument("language", choices=LANGUAGES)
    voices.add_argument("--locale", help="for example pt-BR or es-MX")
    voices.add_argument("--gender", choices=["male", "female", "neutral"])
    voices.add_argument("--limit", type=int, default=20)
    voices.set_defaults(run=cmd_voices)

    add = commands.add_parser("add", help="add numbered voices from the last list to the catalog")
    add.add_argument("language", choices=LANGUAGES)
    add.add_argument("numbers", type=int, nargs="+")
    add.set_defaults(run=cmd_add)

    agent = commands.add_parser("agent", help="create or update the agent and its tools")
    agent.add_argument("--auth", action="store_true", help="require a conversation token (T-203)")
    agent.add_argument("--dry-run", action="store_true", help="print the agent settings without calling ElevenLabs")
    agent.set_defaults(run=cmd_agent)

    args = parser.parse_args()
    args.run(args)


if __name__ == "__main__":
    main()
