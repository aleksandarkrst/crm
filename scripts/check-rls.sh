#!/bin/sh
# RLS coverage (CD-311): every table created in backend/drizzle/*.sql must have row-level security
# turned on and forced, and a tenant policy, in some migration; or be listed, with a reason, in
# scripts/rls-allowlist.txt. Anything new and unlisted fails, whether or not it has a tenant_id
# column, so a table that quietly holds workspace data without RLS can't reach main.
#
# Covered means, across all migrations in order: ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL
# SECURITY and a CREATE POLICY on the table that still exists at the end (DROP POLICY undoes it):
# `tenant_isolation` (the usual three statements), or the append-only pair `tenant_read` +
# `tenant_append` (audit_logs, record_changes). Dropped tables are ignored.
#
#   scripts/check-rls.sh [migrations-dir] [allowlist-file]
#
# POSIX sh + awk (Git Bash on Windows, Linux CI). Exit 1 names every uncovered table.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
dir="${1:-$root/backend/drizzle}"
allowlist="${2:-$root/scripts/rls-allowlist.txt}"
[ -d "$dir" ] || { echo "check-rls: $dir not found" >&2; exit 2; }
[ -f "$allowlist" ] || { echo "check-rls: $allowlist not found" >&2; exit 2; }

exempt=$(sed 's/#.*//' "$allowlist" | tr -s ' \t\r' '\n' | grep -v '^$' | tr '\n' ' ')

out=$(awk -v exempt="$exempt" '
  BEGIN { n = split(exempt, e, " "); for (i = 1; i <= n; i++) skip[e[i]] = 1 }
  # "schema"."table" → schema.table; "table" or "public"."table" → table
  function name(s, prefix,   schema) {
    sub(prefix, "", s)
    schema = ""
    if (s ~ /^"[^"]+"\./) { schema = s; sub(/^"/, "", schema); sub(/".*$/, "", schema); sub(/^"[^"]+"\./, "", s) }
    sub(/^"/, "", s); sub(/".*$/, "", s)
    return (schema == "" || schema == "public") ? s : schema "." s
  }
  function allowed(t,   schema) {
    if (t in skip) return 1
    if (index(t, ".") > 0) { schema = t; sub(/\..*$/, "", schema); if ((schema ".*") in skip) return 1 }
    return 0
  }
  /^[ \t]*--/ { next }
  /CREATE TABLE +(IF NOT EXISTS +)?"/ { created[name($0, "^.*CREATE TABLE +(IF NOT EXISTS +)?")] = 1 }
  /DROP TABLE +(IF EXISTS +)?"/ { dropped[name($0, "^.*DROP TABLE +(IF EXISTS +)?")] = 1 }
  /ALTER TABLE +"[^;]* ENABLE ROW LEVEL SECURITY/ { enabled[name($0, "^.*ALTER TABLE +")] = 1 }
  /ALTER TABLE +"[^;]* FORCE ROW LEVEL SECURITY/ { forced[name($0, "^.*ALTER TABLE +")] = 1 }
  /CREATE POLICY +[A-Za-z0-9_]+ +ON +"/ {
    p = $0; sub(/^.*CREATE POLICY +/, "", p); sub(/ .*$/, "", p)
    policy[name($0, "^.*CREATE POLICY +[A-Za-z0-9_]+ +ON +") "/" p] = 1
  }
  /DROP POLICY +(IF EXISTS +)?[A-Za-z0-9_]+ +ON +"/ {
    p = $0; sub(/^.*DROP POLICY +(IF EXISTS +)?/, "", p); sub(/ .*$/, "", p)
    delete policy[name($0, "^.*DROP POLICY +(IF EXISTS +)?[A-Za-z0-9_]+ +ON +") "/" p]
  }
  END {
    total = 0
    for (t in created) {
      if ((t in dropped) || allowed(t)) continue
      total++
      why = ""
      if (!(t in enabled)) why = why " ENABLE"
      if (!(t in forced)) why = why " FORCE"
      if (!((t "/tenant_isolation") in policy) && !(((t "/tenant_read") in policy) && ((t "/tenant_append") in policy))) why = why " POLICY"
      if (why != "") print "missing " t ":" why
    }
    print "total " total
  }
' "$dir"/*.sql)

total=$(printf '%s\n' "$out" | sed -n 's/^total //p')
missing=$(printf '%s\n' "$out" | sed -n 's/^missing //p' | sort)

if [ -n "$missing" ]; then
  echo "check-rls: tables without row-level security (what is missing after the colon):"
  printf '%s\n' "$missing" | sed 's/^/  - /'
  echo "Add a <NNNN>_<name>_rls.sql migration (.claude/skills/new-tenant-table/rls.sql.template), or list the"
  echo "table with a reason in scripts/rls-allowlist.txt if it holds no workspace data."
  exit 1
fi

echo "check-rls: all $total tables have row-level security (ENABLE + FORCE + a tenant policy)"
