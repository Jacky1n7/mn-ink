#!/bin/zsh
# Dev helper: (re)start MarginNote after a crash, keep extensions enabled, reopen a notebook.
#   scripts/restart-mn.sh [notebookId]
# Clicks "No" on the "temporarily disable the extensions?" alert via the CGEvent click tool.
NB=${1:-7D198A96-C3E4-4F84-8D81-1F759E772308}
TOOLS=${MNINK_TOOLS:-/private/tmp/claude-501/-Users-lixiaoran/0e8dfec8-c9c2-4af1-bc6d-fe50dd4771e5/scratchpad}
osascript -e 'quit app "Problem Reporter"' 2>/dev/null
if ! pgrep -x "MarginNote 4" >/dev/null; then
  open -a "MarginNote 4"; sleep 7
  osascript -e 'tell application "System Events" to set visible of process "Otty" to false'
  osascript -e 'tell application "MarginNote 4" to activate'; sleep 1
  screencapture -x "$TOOLS/full.png"; sips -Z 1200 "$TOOLS/full.png" --out "$TOOLS/restart.png" >/dev/null
  "$TOOLS/click" 794 481; sleep 1.5
  osascript -e 'tell application "System Events" to set visible of process "Otty" to true'
fi
open -g "marginnote4app://notebook/$NB"; sleep 3
