#!/usr/bin/env bash
# Launcher for macOS (launchd) and Linux (systemd). See README.
#
# Runs the bot in the foreground and appends its output to the log files next to
# this script. Staying in the foreground is load bearing: the supervisor
# (launchd's KeepAlive, systemd's Restart=always) treats this process exiting as
# "the bot died" and starts it again, which is the self-heal.
set -euo pipefail
cd "$(dirname "$0")"

# Node from PATH normally. Services start with a minimal PATH that often lacks
# nvm/homebrew shims, so allow NODE_BIN to override, and try the usual homes.
NODE="${NODE_BIN:-}"
if [ -z "$NODE" ]; then
  if command -v node >/dev/null 2>&1; then
    NODE="$(command -v node)"
  elif [ -x /opt/homebrew/bin/node ]; then
    NODE=/opt/homebrew/bin/node        # Apple silicon homebrew
  elif [ -x /usr/local/bin/node ]; then
    NODE=/usr/local/bin/node           # Intel homebrew / most Linux installs
  else
    echo "node not found -- set NODE_BIN in .env or in the service definition" >&2
    exit 1
  fi
fi

exec "$NODE" bot.js >> bot.out.log 2>> bot.err.log
