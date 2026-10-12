#!/bin/zsh
# Dev helper: start MarginNote again after a crash and reopen a notebook.
#   scripts/restart-mn.sh <notebookId>
# MarginNote then asks whether to disable extensions — answer "No". With
# MNINK_TOOLS pointing at a folder holding a CGEvent "click <x> <y>" helper,
# the script clicks it (coordinates for a 1024×768 window at the default spot).
NB=${1:?usage: restart-mn.sh <notebookId>}
TOOLS=${MNINK_TOOLS:-}
osascript -e 'quit app "Problem Reporter"' 2>/dev/null
if ! pgrep -x "MarginNote 4" >/dev/null; then
  open -a "MarginNote 4"; sleep 7
  osascript -e 'tell application "MarginNote 4" to activate'; sleep 1
  if [ -n "$TOOLS" ]; then "$TOOLS/click" 794 481; sleep 1.5; else echo "answer MarginNote's 'disable extensions?' alert with No"; fi
fi
open -g "marginnote4app://notebook/$NB"; sleep 3
