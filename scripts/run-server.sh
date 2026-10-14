#!/bin/bash
# Starts netto's server. Run by launchd in the background (see service.sh), not by hand.
# launchd starts programs with an almost empty environment, so Node has to be loaded first.

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

cd "$(dirname "$0")/.." || exit 1
nvm use >/dev/null 2>&1

echo "--- $(date '+%Y-%m-%d %H:%M:%S') starting netto server"
# exec: launchd watches the node process itself, so it can restart it if it crashes
exec node backend/server/app.js
