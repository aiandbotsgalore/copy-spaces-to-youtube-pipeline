# Bash Strict Mode

For generated scripts (`ingest.sh`), always enable strict mode to prevent silent failures and unsafe variable expansion.

## Standard Header
Put this at the very top of the script, just after the shebang (`#!/bin/bash`).

```bash
set -euo pipefail
```

## Breakdown

| Option | Name | Effect |
| :--- | :--- | :--- |
| `-e` | `errexit` | Exit immediately if a command exits with a non-zero status. |
| `-u` | `nounset` | Treat unset variables as an error and exit. Prevents `rm -rf /$UNDEFINED`. |
| `-o pipefail` | `pipefail` | Returns the exit status of the *last* command in the pipe that failed, rather than the last command in the pipe. |

## Handling Exceptions

Sometimes you *want* a command to fail without stopping the script (e.g., checking if a file exists).

### Pattern: `|| true`
```bash
# Don't exit if directory doesn't exist
rm -rf ./temp || true
```

### Pattern: Conditional Checks
```bash
# Safe check inside strict mode
if [ -f "config.json" ]; then
  echo "File exists"
fi
```

## Common Traps

### Unbound Variables
If you need a default value for a possibly unset variable:
```bash
echo "${NAME:-DefaultName}" # Safe even with set -u
```
