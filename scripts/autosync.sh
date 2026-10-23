#!/bin/bash
# Keeps this checkout an exact copy of GitHub in the background with launchd (see autosync.js for what it does):
# whatever branch was pushed most recently is checked out here within seconds, and the running server and
# open pages (this Mac, and the phone through Tailscale) reload by themselves.
# To follow one branch only, install with it set:  NETTO_SYNC_BRANCH=main bash scripts/autosync.sh install
# Install the server service first (scripts/service.sh install): this uses the same node binary,
# the one already allowed to read ~/Documents.
#
#   bash scripts/autosync.sh install    set it up (once) and start it now; re-run after editing this file
#   bash scripts/autosync.sh stop       pause it until the next login (or `start`)
#   bash scripts/autosync.sh start      start it again after `stop`
#   bash scripts/autosync.sh status     is it running?
#   bash scripts/autosync.sh log        last lines of its log: what it pulled, or why it skipped
#   bash scripts/autosync.sh uninstall  remove it completely

LABEL="com.netto.autosync"
SERVER_PLIST="$HOME/Library/LaunchAgents/com.netto.server.plist"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/netto-sync.log"
DOMAIN="gui/$(id -u)"
# The running copy lives outside the repo: the branch checked out may not have scripts/autosync.js
RUNNING_COPY="$HOME/Library/Application Support/netto/autosync.js"

case "$1" in
  install)
    # macOS only lets a background program read ~/Documents if that exact program is allowed (Full Disk Access).
    # The server's node already is, and git started by it inherits that permission, so use the same one.
    [ -f "$SERVER_PLIST" ] || { echo "Install the server service first: bash scripts/service.sh install"; exit 1; }
    NODE="$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "$SERVER_PLIST")"
    [ -x "$NODE" ] || { echo "The server's node ($NODE) is gone: re-run bash scripts/service.sh install"; exit 1; }

    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs" "$(dirname "$RUNNING_COPY")"
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null   # replace an older install
    cp "$PROJECT_DIR/scripts/autosync.js" "$RUNNING_COPY"

    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$RUNNING_COPY</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NETTO_PROJECT_DIR</key> <string>$PROJECT_DIR</string>
    <key>NETTO_SYNC_BRANCH</key> <string>$NETTO_SYNC_BRANCH</string>
  </dict>
  <key>WorkingDirectory</key>  <string>$PROJECT_DIR</string>
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
    sleep 3
    echo "Auto-sync is running and will start by itself at every login. Latest:"
    tail -n 3 "$LOG"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
    rm -f "$PLIST" "$RUNNING_COPY"
    echo "Removed. This checkout no longer pulls from GitHub by itself."
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
      tail -n 1 "$LOG"
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
