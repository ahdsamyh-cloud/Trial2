#!/bin/bash
# Double-click this file to start Litigation Manager on a Mac.
cd "$(dirname "$0")"
echo "=============================================="
echo "  Litigation Manager"
echo "=============================================="
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "Node.js is not installed."
  echo "Install the LTS version from https://nodejs.org, then double-click this file again."
  open "https://nodejs.org"
  read -r -p "Press Enter to close this window..."
  exit 1
fi
echo "Starting... your browser will open at http://localhost:3000"
echo "Keep this window open while you use the app. Close it to stop the app."
echo ""
node --disable-warning=ExperimentalWarning server.js --open
read -r -p "The app has stopped. Press Enter to close this window..."
