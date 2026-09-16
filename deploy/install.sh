#!/bin/sh
# Install a launchd agent (macOS) that keeps the reading-buddy hub running.
# Paths are resolved at install time, so the repo can live anywhere.
#
#   sh deploy/install.sh            # install / reinstall
#   READING_BUDDY_PORT=9000 sh deploy/install.sh   # custom port (also change extension/src/background.ts)
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
LABEL=${READING_BUDDY_LABEL:-com.reading-buddy.hub}
PORT=${READING_BUDDY_PORT:-8737}
NODE=$(command -v node || true)
LA_DIR="$HOME/Library/LaunchAgents"
LOG="$HOME/Library/Logs/reading-buddy-hub.log"
UID_NUM=$(id -u)

[ -n "$NODE" ] || { echo "error: node not found in PATH" >&2; exit 1; }
[ -f "$ROOT/node_modules/tsx/dist/cli.mjs" ] || { echo "error: run 'npm install' in $ROOT first" >&2; exit 1; }
mkdir -p "$LA_DIR" "$HOME/Library/Logs"

PLIST="$LA_DIR/$LABEL.plist"
sed \
  -e "s|@LABEL@|$LABEL|g" \
  -e "s|@NODE@|$NODE|g" \
  -e "s|@ROOT@|$ROOT|g" \
  -e "s|@PORT@|$PORT|g" \
  -e "s|@HOME@|$HOME|g" \
  -e "s|@LOG@|$LOG|g" \
  "$HERE/hub.plist.template" > "$PLIST"

launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$PLIST"
echo "installed: $LABEL ($PLIST)"
echo "log:       $LOG"
echo "check:     curl -s http://127.0.0.1:$PORT/state"
echo "restart:   launchctl kickstart -k gui/$UID_NUM/$LABEL"
