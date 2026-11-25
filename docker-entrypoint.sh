#!/bin/sh
# Drops root before starting the server. If CONFIG_FILE (e.g. Home Assistant's
# /data/options.json) is readable only by root, hand the `node` user a private
# copy of it first.
set -eu

if [ "$(id -u)" != 0 ]; then
  exec "$@"
fi

if [ -n "${CONFIG_FILE:-}" ] && [ -f "$CONFIG_FILE" ]; then
  install -d -m 0700 -o node -g node /tmp/rest980
  install -m 0400 -o node -g node "$CONFIG_FILE" /tmp/rest980/config.json
  export CONFIG_FILE=/tmp/rest980/config.json
fi

if ! setpriv --reuid=node --regid=node --clear-groups true 2>/dev/null; then
  echo 'Cannot switch to the node user (no SETUID/SETGID capability, e.g. --cap-drop ALL).' >&2
  echo 'Run the container with --user 1000:1000 instead.' >&2
  exit 1
fi
exec setpriv --reuid=node --regid=node --clear-groups --no-new-privs -- "$@"
