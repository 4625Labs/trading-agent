#!/usr/bin/env bash
# Prompts silently for each key in .env.example and writes it to .env. Never echoes values.
# Press Enter to keep the existing value. Run from the repo root: ./scripts/set-env.sh
set -euo pipefail
touch .env
chmod 600 .env
grep -E '^[A-Z_]+=' .env.example | cut -d= -f1 | while read -r key; do
  printf '%s (hidden, Enter to skip): ' "$key" > /dev/tty
  IFS= read -rs val < /dev/tty; printf '\n' > /dev/tty
  [ -z "$val" ] && continue
  grep -v "^${key}=" .env > .env.tmp || true
  printf '%s=%s\n' "$key" "$val" >> .env.tmp
  mv .env.tmp .env
done
chmod 600 .env
echo "Done. Keys set: $(grep -cE '^[A-Z_]+=.+' .env)" 
