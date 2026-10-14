#!/bin/bash

PROJECT_DIR="/Users/bidoiasimone/Documents/GitHub/money-tracker"
PORT=3000
LOG="/tmp/moneytracker.log"
# The standalone app made once with Safari > File > Add to Dock (see the setup notes in netto.applescript)
WEBAPP="$HOME/Applications/netto.app"

case "$1" in
  start)
    # Make Node available (apps don't load your normal shell setup)
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
    export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

    cd "$PROJECT_DIR" || exit 1
    nvm use >/dev/null 2>&1

    # Only start the server if nothing is listening on the port yet
    if ! lsof -ti tcp:$PORT -sTCP:LISTEN >/dev/null; then
      # AUTO_EXIT=1: the server stops by itself once the app window is closed (see backend/server/appWindow/openWindowSessions.js)
      AUTO_EXIT=1 nohup npm start > "$LOG" 2>&1 < /dev/null &

      # Wait up to ~10 seconds for the server to answer
      for i in {1..20}; do
        curl -s -o /dev/null "http://localhost:$PORT" && break
        sleep 0.5
      done
    fi

    if [ -d "$WEBAPP" ]; then
      open -a "$WEBAPP"                 # opens it, or brings it to the front if already open
    else
      open -na "Firefox" --args --new-window "http://localhost:$PORT"   # fallback until the web app exists
    fi
    ;;

  stop)
    lsof -ti tcp:$PORT -sTCP:LISTEN | xargs kill 2>/dev/null
    [ -d "$WEBAPP" ] && osascript -e "tell application \"$WEBAPP\" to quit" 2>/dev/null
    true
    ;;
esac