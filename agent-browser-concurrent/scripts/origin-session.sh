#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  printf 'usage: %s <url> [suffix]\n' "$(basename "$0")" >&2
  exit 1
fi

python3 - "$1" "$2" <<'PY'
import re
import sys
from urllib.parse import urlparse

raw = sys.argv[1].strip()
suffix = sys.argv[2].strip().lower() if len(sys.argv) > 2 and sys.argv[2] else ""
candidate = raw if "://" in raw else f"https://{raw}"
parsed = urlparse(candidate)

if (
    not parsed.scheme
    or not parsed.netloc
    or parsed.hostname is None
    or any(ch.isspace() for ch in raw)
    or any(ch.isspace() for ch in parsed.hostname)
):
    raise SystemExit(f"invalid url: {raw}")

host = (parsed.hostname or "").lower()
port = parsed.port
default_port = (
    (parsed.scheme == "http" and port in (None, 80))
    or (parsed.scheme == "https" and port in (None, 443))
)
origin_key = f"{parsed.scheme}-{host}" if default_port else f"{parsed.scheme}-{host}-{port}"
session = re.sub(r"[^a-z0-9]+", "-", origin_key).strip("-")
if suffix:
    suffix = re.sub(r"[^a-z0-9]+", "-", suffix).strip("-")
    if suffix:
        session = f"{session}-{suffix}"
print(session or "default")
PY
