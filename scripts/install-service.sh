#!/usr/bin/env bash
# Installs the bot as a background service that starts at login and restarts if
# it dies: launchd on macOS, a systemd user unit on Linux. No sudo needed --
# both are per-user services.
#
#   bash scripts/install-service.sh            # install and start
#   bash scripts/install-service.sh --uninstall
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.homewiki.bot"

uninstall=false
[ "${1:-}" = "--uninstall" ] && uninstall=true

case "$(uname -s)" in
  Darwin)
    PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

    if $uninstall; then
      launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
      rm -f "$PLIST"
      echo "Removed $LABEL."
      exit 0
    fi

    mkdir -p "$HOME/Library/LaunchAgents"
    # KeepAlive restarts the bot whenever it exits, which is the self-heal.
    # RunAtLoad starts it at login. launchd inherits almost no PATH, so the
    # node lookup lives in run-bot.sh and CLAUDE_BIN should be an absolute path
    # in .env.
    cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>              <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO/run-bot.sh</string>
  </array>
  <key>WorkingDirectory</key>   <string>$REPO</string>
  <key>RunAtLoad</key>          <true/>
  <key>KeepAlive</key>          <true/>
  <key>ThrottleInterval</key>   <integer>30</integer>
</dict>
</plist>
PLIST_EOF

    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"

    echo ""
    echo "Installed $LABEL (starts at login, restarts if it dies)."
    echo "  launchctl print gui/$(id -u)/$LABEL   # status"
    echo "  launchctl kickstart -k gui/$(id -u)/$LABEL   # restart after editing bot.js or .env"
    echo "  tail -f $REPO/bot.out.log             # follow the log"
    echo "  bash scripts/install-service.sh --uninstall"
    ;;

  Linux)
    UNIT="$HOME/.config/systemd/user/homewiki-bot.service"

    if $uninstall; then
      systemctl --user disable --now homewiki-bot.service 2>/dev/null || true
      rm -f "$UNIT"
      systemctl --user daemon-reload
      echo "Removed homewiki-bot.service."
      exit 0
    fi

    mkdir -p "$(dirname "$UNIT")"
    cat > "$UNIT" <<UNIT_EOF
[Unit]
Description=homewiki-bot -- Telegram bridge to a local Claude Code session
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$REPO
ExecStart=/usr/bin/env bash $REPO/run-bot.sh
Restart=always
RestartSec=30

[Install]
WantedBy=default.target
UNIT_EOF

    systemctl --user daemon-reload
    systemctl --user enable --now homewiki-bot.service

    echo ""
    echo "Installed homewiki-bot.service (starts at login, restarts if it dies)."
    echo "  systemctl --user status homewiki-bot     # status"
    echo "  systemctl --user restart homewiki-bot    # restart after editing bot.js or .env"
    echo "  tail -f $REPO/bot.out.log                # follow the log"
    echo ""
    echo "To keep it running when you're not logged in: sudo loginctl enable-linger \$USER"
    ;;

  *)
    echo "Unsupported OS: $(uname -s). On Windows use scripts\\install-service.ps1." >&2
    exit 1
    ;;
esac
