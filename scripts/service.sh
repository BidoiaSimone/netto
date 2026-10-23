#!/bin/bash
# Keeps netto's server running in the background with launchd (macOS's service manager):
# it starts when you log in and is restarted automatically if it ever crashes.
# It also reloads by itself when you save backend code (node --watch), so no manual restart
# is needed after editing routes, migrations, etc. Only the code files the server actually loads
# are watched, never the database, so adding transactions doesn't trigger a reload.
# If a saved file has an error, the server stays down until you save a fixed version.
#
#   bash scripts/service.sh install    set it up (once) and start it now; re-run after editing this file
#   bash scripts/service.sh restart    force a reload (normally not needed)
#   bash scripts/service.sh stop       stop it until the next restart/login (or `start`)
#   bash scripts/service.sh start      start it again after `stop`
#   bash scripts/service.sh status     is it running?
#   bash scripts/service.sh log        last lines of the server log
#   bash scripts/service.sh uninstall  remove it completely
#
# Add "expenses" after any of these for netto expenses (backend/config/edition.js), a second server of its own on
# port 3003 with its own data (expenses.db), next to the full one:  bash scripts/service.sh install expenses
# For the phone, give it its own Tailscale address once:  tailscale serve --bg --https=8443 3003

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="gui/$(id -u)"
case "${2:-full}" in
  full)     LABEL="com.netto.server";   PORT=3000; LOG="$HOME/Library/Logs/netto.log";          EDITION="" ;;
  expenses) LABEL="com.netto.expenses"; PORT=3003; LOG="$HOME/Library/Logs/netto-expenses.log"; EDITION="expenses" ;;
  *)        echo "Unknown edition \"$2\": leave it out for the full netto, or write expenses"; exit 1 ;;
esac
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
# The full netto runs as always (port 3000 is the server's default); another edition is told which one it is and its port
ENVIRONMENT_VARIABLES=""
[ -n "$EDITION" ] && ENVIRONMENT_VARIABLES="<key>EnvironmentVariables</key>
  <dict>
    <key>NETTO_EDITION</key> <string>$EDITION</string>
    <key>PORT</key>          <string>$PORT</string>
  </dict>"

case "$1" in
  install)
    # Find the node binary this project uses (nvm + .nvmrc), as a real path.
    # launchd runs node DIRECTLY, not through bash: macOS only lets a background program
    # read ~/Documents if that exact program has been allowed (Full Disk Access),
    # so it must be one specific binary we can allow, not bash (which runs every script).
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
    export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
    cd "$PROJECT_DIR" && nvm use >/dev/null 2>&1
    NODE="$(command -v node)"
    [ -n "$NODE" ] || { echo "node not found"; exit 1; }
    # --watch (auto-reload on code changes) needs Node 18.11 or newer
    "$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>18||(a===18&&b>=11)?0:1)' \
      || { echo "Node $("$NODE" -v) is too old for auto-reload: install Node 18.11+ (e.g. nvm install --lts)"; exit 1; }
    NODE="$(cd "$(dirname "$NODE")" && pwd -P)/$(basename "$NODE")"
    while [ -L "$NODE" ]; do                       # follow symlinks (e.g. Homebrew)
      T="$(readlink "$NODE")"; case "$T" in /*) NODE="$T";; *) NODE="$(dirname "$NODE")/$T";; esac
    done

    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null   # replace an older install
    # a server started some other way (launcher, npm start) would hold the port
    lsof -ti tcp:$PORT -sTCP:LISTEN | xargs kill 2>/dev/null
    sleep 1

    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>--watch</string>
    <string>--watch-preserve-output</string>
    <string>$PROJECT_DIR/backend/server/app.js</string>
  </array>
  <key>WorkingDirectory</key>  <string>$PROJECT_DIR</string>
  $ENVIRONMENT_VARIABLES
  <key>RunAtLoad</key>         <true/>
  <key>KeepAlive</key>         <true/>
  <key>ThrottleInterval</key>  <integer>10</integer>
  <key>StandardOutPath</key>   <string>$LOG</string>
  <key>StandardErrorPath</key> <string>$LOG</string>
</dict>
</plist>
PLIST

    : > "$LOG"   # start with a clean log
    launchctl bootstrap "$DOMAIN" "$PLIST" || exit 1
    for i in {1..20}; do curl -s -o /dev/null "http://localhost:$PORT" && break; sleep 0.5; done
    if curl -s -o /dev/null "http://localhost:$PORT"; then
      echo "netto${EDITION:+ $EDITION} is running at http://localhost:$PORT and will start by itself at every login."
    elif grep -q "Operation not permitted" "$LOG"; then
      echo
      echo "macOS is blocking the server from reading your Documents folder."
      echo "Allow it once: System Settings > Privacy & Security > Full Disk Access > + , then add:"
      echo
      echo "    $NODE"
      echo
      echo "(in the file picker press Cmd+Shift+G and paste that path). Then run:"
      echo "    bash scripts/service.sh restart $EDITION"
      open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" 2>/dev/null
    else
      echo "Installed, but the server isn't answering yet. Check: bash scripts/service.sh log"
    fi
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
    rm -f "$PLIST"
    echo "Removed. The server no longer runs in the background."
    ;;
  restart)
    launchctl kickstart -k "$DOMAIN/$LABEL" && echo "Restarted."
    ;;
  stop)
    launchctl bootout "$DOMAIN/$LABEL" && echo "Stopped (it comes back at the next login, or with: start)."
    ;;
  start)
    launchctl bootstrap "$DOMAIN" "$PLIST" && echo "Started."
    ;;
  status)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      launchctl print "$DOMAIN/$LABEL" | grep -E "^\s*(state|pid|last exit code) ="
    else
      echo "Not installed or stopped."
    fi
    ;;
  log)
    tail -n 50 "$LOG"
    ;;
  *)
    sed -n '2,15p' "$0"   # print the usage notes at the top of this file
    exit 1
    ;;
esac
