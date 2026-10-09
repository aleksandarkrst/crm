#!/bin/sh
# Checks that every tenant-scoped table in backend/drizzle/*.sql has a row-level security policy.
#
# A table is tenant-scoped when its CREATE TABLE statement has a "tenant_id" column. It is covered
# when any migration has CREATE POLICY ... ON "<table>". Tables dropped by a later migration are
# ignored. memberships and invitations carry tenant_id but intentionally have no policy: they
# decide access before a tenant context exists (docs/ARCHITECTURE.md, "Teams and invitations").
#
# Runs with POSIX sh + awk (Git Bash on Windows, Linux CI). Exit 1 lists the uncovered tables.
set -eu

root=$(cd "$(dirname "$0")/../../.." && pwd)
dir="$root/backend/drizzle"
if [ ! -d "$dir" ]; then
  echo "check-rls: $dir not found" >&2
  exit 2
fi

exempt="memberships invitations"

out=$(awk -v exempt="$exempt" '
  BEGIN { n = split(exempt, e, " "); for (i = 1; i <= n; i++) skip[e[i]] = 1 }
  function name(s, prefix) { sub(prefix, "", s); sub(/^"public"\./, "", s); sub(/^"/, "", s); sub(/".*$/, "", s); return s }
  /CREATE TABLE +(IF NOT EXISTS +)?("public"\.)?"/ { cur = name($0, "^.*CREATE TABLE +(IF NOT EXISTS +)?"); created[cur] = 1; intable = 1 }
  intable && /"tenant_id"/ { scoped[cur] = 1 }
  intable && /^\);/ { intable = 0 }
  /CREATE POLICY +[A-Za-z0-9_]+ +ON +("public"\.)?"/ { policy[name($0, "^.*CREATE POLICY +[A-Za-z0-9_]+ +ON +")] = 1 }
  /DROP TABLE +(IF EXISTS +)?("public"\.)?"/ { dropped[name($0, "^.*DROP TABLE +(IF EXISTS +)?")] = 1 }
  END {
    total = 0
    for (t in created) {
      if (!(t in scoped) || (t in dropped) || (t in skip)) continue
      total++
      if (!(t in policy)) print "missing " t
    }
    print "total " total
  }
' "$dir"/*.sql)

total=$(printf '%s\n' "$out" | sed -n 's/^total //p')
missing=$(printf '%s\n' "$out" | sed -n 's/^missing //p' | sort)

if [ -n "$missing" ]; then
  echo "Tenant-scoped tables without a tenant_isolation policy:"
  printf '%s\n' "$missing" | sed 's/^/  - /'
  echo "Add a <NNNN>_<name>_rls.sql migration (see .claude/skills/new-tenant-table/rls.sql.template)."
  exit 1
fi

echo "All $total tables have a tenant_isolation policy"
