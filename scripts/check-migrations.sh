#!/bin/sh
# Migration safety (CD-311, "expand, then contract" in docs/WORKFLOW.md section 7): the migrations a
# pull request adds must not drop or change what deployed code may still read, because a failed
# deploy rolls the images back but not the migration. Fails on
#   DROP COLUMN, DROP TABLE, ALTER COLUMN … TYPE, RENAME COLUMN, RENAME TO,
#   SET NOT NULL on a column that has no default (in any migration)
# unless the pull request description has a `migration-plan:` section that explains the
# maintenance window or the restore plan; the findings are then printed as accepted.
#
#   PR_BODY='…' scripts/check-migrations.sh [base-ref]        (base-ref: origin/main)
#   PR_BODY_FILE=body.md scripts/check-migrations.sh origin/main
#   GUARD_FILES=$'backend/drizzle/0099_x.sql' scripts/check-migrations.sh   (files instead of a diff)
#
# POSIX sh + awk. Exit 1 lists each statement with its file and line.
set -eu

root="${GUARD_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
. "$(cd "$(dirname "$0")" && pwd)/lib-changed-files.sh"
base="${1:-origin/main}"
cd "$root"

body="${PR_BODY:-}"
if [ -z "$body" ] && [ -n "${PR_BODY_FILE:-}" ] && [ -f "$PR_BODY_FILE" ]; then body=$(cat "$PR_BODY_FILE"); fi
# A heading or a line that starts with migration-plan: (markdown markers and bold allowed).
if printf '%s\n' "$body" | grep -Eiq '^[[:space:]]*(#+[[:space:]]*|[*_]{1,2})?migration-plan[*_]{0,2}:'; then planned=1; else planned=0; fi

files=$(changed_files "$base" backend/drizzle/ | grep '\.sql$' || true)
if [ -z "$files" ]; then
  echo "check-migrations: no migration files added or changed against $base"
  exit 0
fi

# Columns with a default anywhere in the migrations, as "table.column": ALTER COLUMN … SET DEFAULT,
# or a DEFAULT in the column's own line of its CREATE TABLE (a table is created once).
defaults=$(awk '
  function tbl(s, prefix) { sub(prefix, "", s); sub(/^"public"\./, "", s); sub(/^"/, "", s); sub(/".*$/, "", s); return s }
  function col(s, prefix) { sub(prefix, "", s); sub(/^"/, "", s); sub(/".*$/, "", s); return s }
  FNR == 1 { intable = "" }
  /^[ \t]*--/ { next }
  /CREATE TABLE +(IF NOT EXISTS +)?("public"\.)?"/ { intable = tbl($0, "^.*CREATE TABLE +(IF NOT EXISTS +)?"); next }
  intable != "" && /^[ \t]*"[^"]+"[ \t]/ && / DEFAULT / { c = $0; sub(/^[ \t]*"/, "", c); sub(/".*$/, "", c); print intable "." c }
  intable != "" && /^\);/ { intable = "" }
  /ALTER TABLE +("public"\.)?"[^"]+" +ALTER COLUMN +"[^"]+" +SET DEFAULT/ { print tbl($0, "^.*ALTER TABLE +") "." col($0, "^.*ALTER COLUMN +") }
' backend/drizzle/*.sql $files | sort -u | tr '\n' ' ')

findings=""
for f in $files; do
  [ -f "$f" ] || continue
  found=$(awk -v defaults=" $defaults " '
    function tbl(s, prefix) { sub(prefix, "", s); sub(/^"public"\./, "", s); sub(/^"/, "", s); sub(/".*$/, "", s); return s }
    function col(s, prefix) { sub(prefix, "", s); sub(/^"/, "", s); sub(/".*$/, "", s); return s }
    /^[ \t]*--/ { next }
    {
      line = $0; sub(/--> statement-breakpoint/, "", line)
      if (line ~ /DROP COLUMN/) print FILENAME ":" FNR ": DROP COLUMN — " line
      else if (line ~ /DROP TABLE/) print FILENAME ":" FNR ": DROP TABLE — " line
      else if (line ~ /ALTER COLUMN +"[^"]+" +(SET DATA +)?TYPE/) print FILENAME ":" FNR ": ALTER COLUMN … TYPE — " line
      else if (line ~ /RENAME COLUMN/) print FILENAME ":" FNR ": RENAME COLUMN — " line
      else if (line ~ /RENAME TO/) print FILENAME ":" FNR ": RENAME TO — " line
      else if (line ~ /ALTER COLUMN +"[^"]+" +SET NOT NULL/) {
        key = " " tbl(line, "^.*ALTER TABLE +") "." col(line, "^.*ALTER COLUMN +") " "
        if (index(defaults, key) == 0) print FILENAME ":" FNR ": SET NOT NULL without a default — " line
      }
    }
  ' "$f")
  [ -n "$found" ] && findings="${findings}${found}
"
done

if [ -z "$findings" ]; then
  echo "check-migrations: $(printf '%s\n' "$files" | wc -l | tr -d ' ') migration file(s) checked, nothing destructive"
  exit 0
fi

if [ "$planned" = 1 ]; then
  echo "check-migrations: destructive statements accepted because the pull request has a migration-plan: section:"
  printf '%s' "$findings" | sed 's/^/  - /'
  exit 0
fi

echo "check-migrations: destructive statements in new migrations (docs/WORKFLOW.md section 7, expand then contract):"
printf '%s' "$findings" | sed 's/^/  - /'
echo "Drop, rename or retype a column only in a later release, after no deployed code reads it, and give"
echo "a NOT NULL column a default. If this change can't follow that, add a 'migration-plan:' section to the"
echo "pull request description with the maintenance window or the restore plan; the check then passes."
exit 1
