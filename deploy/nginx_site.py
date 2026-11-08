#!/usr/bin/env python3
"""Add Learning Grounds' sites to tagmephotos's nginx, or take them out again (docs/DEPLOY.md).

    python3 /opt/learning-grounds/deploy/nginx_site.py install learningrounds.com
    python3 /opt/learning-grounds/deploy/nginx_site.py remove

tagme's nginx (container tagme-nginx-1) owns ports 80 and 443 and reads one file,
/srv/tagme/nginx/nginx.conf. This puts deploy/nginx.conf into that file's http block between two
marker lines, replacing any earlier copy, and keeps the file as it was first as
nginx.conf.before-learning-grounds. It writes the file in place, because the container sees it
through a single-file mount, which a replaced file would break. It then tests the whole config
inside the container and reloads nginx only if the test passes. Otherwise it puts the old file back,
so tagmephotos keeps running as before.
"""
import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TARGET = Path("/srv/tagme/nginx/nginx.conf")
BACKUP = TARGET.with_name("nginx.conf.before-learning-grounds")
CONTAINER = "tagme-nginx-1"
BEGIN = "    # >>> learning-grounds: managed by /opt/learning-grounds/deploy/nginx_site.py"
END = "    # <<< learning-grounds"


def without_block(text: str) -> str:
    start = text.find(BEGIN)
    if start == -1:
        return text
    end = text.find(END, start)
    if end == -1:
        sys.exit(f"{TARGET} has the start marker but no end marker. Fix it by hand before running this.")
    end += len(END)
    if text[end : end + 1] == "\n":
        end += 1
    return text[:start] + text[end:]


def with_block(text: str, block: str) -> str:
    text = without_block(text)
    # The http block is the file's last block, so our servers go just before its closing brace.
    close = text.rstrip().rfind("}")
    if close == -1:
        sys.exit(f"{TARGET} has no closing brace to put our sites before.")
    lines = ["    " + line if line.strip() else "" for line in block.strip().splitlines()]
    return text[:close] + BEGIN + "\n" + "\n".join(lines) + "\n" + END + "\n" + text[close:]


def write_in_place(text: str) -> None:
    with TARGET.open("r+") as file:
        file.seek(0)
        file.write(text)
        file.truncate()


def nginx(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["docker", "exec", CONTAINER, "nginx", *args], capture_output=True, text=True)


def apply(new: str, old: str) -> None:
    write_in_place(new)
    seen = subprocess.run(["docker", "exec", CONTAINER, "cat", "/etc/nginx/nginx.conf"], capture_output=True, text=True)
    if seen.stdout != new:
        write_in_place(old)
        sys.exit(f"{CONTAINER} doesn't see the new file, so nothing changed. Its mount may need a restart.")
    test = nginx("-t")
    if test.returncode != 0:
        write_in_place(old)
        sys.exit("nginx rejected the change. The old file is back and nothing was reloaded:\n" + test.stderr)
    reload = nginx("-s", "reload")
    if reload.returncode != 0:
        write_in_place(old)
        nginx("-s", "reload")
        sys.exit("nginx couldn't reload, so the old file is back:\n" + reload.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", choices=["install", "remove"])
    parser.add_argument("domain", nargs="?", help="install only: our domain, such as learningrounds.com")
    args = parser.parse_args()

    old = TARGET.read_text()
    if args.action == "remove":
        apply(without_block(old), old)
        print("Learning Grounds' sites are out of tagme's nginx, and nginx reloaded.")
        return

    domain = re.sub(r"^https?://", "", (args.domain or "").strip().lower()).strip("/").removeprefix("www.")
    if not re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)+", domain):
        sys.exit("Give our domain, such as: nginx_site.py install learningrounds.com")
    if not Path(f"/etc/letsencrypt/live/{domain}/fullchain.pem").exists():
        sys.exit(f"There's no certificate for {domain} yet. Get it with certbot first (docs/DEPLOY.md, step 5).")
    if not BACKUP.exists():
        shutil.copy2(TARGET, BACKUP)
    block = (HERE / "nginx.conf").read_text().replace("DOMAIN", domain)
    apply(with_block(old, block), old)
    print(f"Added {domain}, www.{domain} and api.{domain} to tagme's nginx, and nginx reloaded.")
    print(f"tagme's file as it was before: {BACKUP}")


if __name__ == "__main__":
    main()
