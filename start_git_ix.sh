#!/usr/bin/env bash
# /home/lab/git_ix/start_git_ix.sh
#!/usr/bin/env bash
SESSION=git_ix
DIR="$HOME/git_ix"

# only create the session if it doesn't exist
if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  cd "$DIR" || exit 1
  # -l ensures bash loads your login env (needed if you rely on nvm, etc.)
  tmux new-session  -d  -s "$SESSION"  "/bin/bash -c 'source \"$HOME/.nvm/nvm.sh\" && npm start -- -H 0.0.0.0 -p 3001'"
fi
