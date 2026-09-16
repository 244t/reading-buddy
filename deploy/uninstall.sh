#!/bin/sh
set -eu
LABEL=${READING_BUDDY_LABEL:-com.reading-buddy.hub}
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "removed: $LABEL"
