#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  printf 'usage: %s <url>\n' "$(basename "$0")" >&2
  exit 1
fi

python3 - "$1" <<'PY'
import re
import sys
from urllib.parse import urlparse

raw = sys.argv[1].strip()
candidate = raw if "://" in raw else f"https://{raw}"
parsed = urlparse(candidate)

if not parsed.scheme or not parsed.netloc:
    raise SystemExit(f"invalid url: {raw}")

host = (parsed.hostname or "").lower()
port = parsed.port
default_port = (
    (parsed.scheme == "http" and port in (None, 80))
    or (parsed.scheme == "https" and port in (None, 443))
)
origin_key = f"{parsed.scheme}-{host}" if default_port else f"{parsed.scheme}-{host}-{port}"
session = re.sub(r"[^a-z0-9]+", "-", origin_key).strip("-")
print(session or "default")
PY
