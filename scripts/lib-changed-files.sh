# Shared by scripts/check-migrations.sh and scripts/check-tenant-tests.sh (CD-311): the files a
# pull request adds or changes, read from the working tree. Sourced, not run.
#
#   changed_files <base-ref> <path-prefix>
#
# Lists the added, copied, modified or renamed files under the prefix between the merge base of
# <base-ref> and HEAD, one per line. GUARD_FILES (newline-separated repository paths) replaces the
# git diff, so the self-test and a local run can name files that aren't committed yet.

changed_files() {
  base="$1"
  prefix="$2"
  if [ -n "${GUARD_FILES:-}" ]; then
    printf '%s\n' "$GUARD_FILES" | grep "^${prefix}" || true
    return 0
  fi
  if ! git rev-parse --verify --quiet "$base" >/dev/null; then
    echo "guards: base ref '$base' not found. Run 'git fetch origin main' first." >&2
    return 2
  fi
  git diff --name-only --diff-filter=ACMR "$base...HEAD" -- "$prefix" || return 2
}
