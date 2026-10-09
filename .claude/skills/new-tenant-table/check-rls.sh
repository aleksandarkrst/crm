#!/bin/sh
# Kept for the skill's instructions and older notes: the check itself moved to scripts/check-rls.sh
# (CD-311), where CI runs it on every pull request with its allowlist (scripts/rls-allowlist.txt).
exec sh "$(dirname "$0")/../../../scripts/check-rls.sh" "$@"
