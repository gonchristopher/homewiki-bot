#!/usr/bin/env bash
# Launcher for macOS (launchd) and Linux (systemd). See README.
#
# Runs the bot in the foreground and appends its output to logs/ beside this
# script, rotating the previous run's logs aside first. Staying in the
# foreground is load bearing: the supervisor
# (launchd's KeepAlive, systemd's Restart=always) treats this process exiting as
# "the bot died" and starts it again, which is the self-heal.
set -euo pipefail
cd "$(dirname "$0")"

# Logs live in logs/, not next to the code, and each run gets a fresh pair. The
# previous pair is archived under the time it was rotated
# (logs/bot.out-2026-08-27-113708.log). Without this the two files grow without
# bound and every restart is buried mid-file, which made "is the new code
# actually running?" needlessly hard to answer.
#
# 0700 because these are not ordinary logs: every question and answer passes
# through them, so the archive is a running transcript of the household's
# medical and financial conversations. Same reasoning as the 0600 on .env.
LOG_DIR="${LOG_DIR:-logs}"
mkdir -p "$LOG_DIR"
chmod 700 "$LOG_DIR" 2>/dev/null || true

# Older versions wrote to the repo root. Move those in rather than orphaning
# them, so the history stays in one place and stops cluttering the checkout.
# The `if` rather than `[ -f ] &&` is deliberate: under `set -e` a bare test
# that fails on the LAST iteration would take the whole launcher down with it.
for legacy in bot.out.log bot.err.log; do
  if [ -f "$legacy" ]; then
    mv -- "$legacy" "$LOG_DIR/$legacy"
  fi
done

# Archives are pruned to the newest LOG_ARCHIVES_KEEP of each stream. Note the
# interaction with Restart=always: a bot that is crash-looping every RestartSec
# seconds rotates that fast too, so the archive explaining the FIRST crash can
# age out within minutes. Raise this if you're chasing a loop.
LOG_ARCHIVES_KEEP="${LOG_ARCHIVES_KEEP:-15}"

rotate_log() {
  local stem="$1" file="$LOG_DIR/$1.log" old
  # Nothing to archive if the last run wrote nothing -- don't manufacture empty
  # files, which would otherwise be the bulk of the archive during a restart loop.
  [ -s "$file" ] || return 0
  mv -- "$file" "$LOG_DIR/${stem}-$(date +%Y-%m-%d-%H%M%S).log"
  # Newest first; everything past the keep count goes. `|| true` because the
  # glob matching nothing is a normal state, not an error, and this runs under
  # `set -o pipefail`.
  old="$(ls -1t "$LOG_DIR/${stem}"-*.log 2>/dev/null | tail -n "+$((LOG_ARCHIVES_KEEP + 1))" || true)"
  if [ -n "$old" ]; then
    printf '%s\n' "$old" | while IFS= read -r f; do rm -f -- "$f"; done
  fi
}

rotate_log bot.out
rotate_log bot.err

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

exec "$NODE" bot.js >> "$LOG_DIR/bot.out.log" 2>> "$LOG_DIR/bot.err.log"
