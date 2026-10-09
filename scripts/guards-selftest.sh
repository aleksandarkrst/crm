#!/bin/sh
# Proves the CI guards (CD-311) catch what they must, on a scratch copy of the migrations, so a
# change to the scripts can't silently let a bad migration through. Runs in CI before the guards.
#
#   scripts/guards-selftest.sh
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/backend/drizzle" "$tmp/backend/test/integration" "$tmp/scripts"
cp "$root"/backend/drizzle/*.sql "$tmp/backend/drizzle/"
cp "$root/scripts/rls-allowlist.txt" "$tmp/scripts/"

failures=0
pass() { printf '[selftest] PASS: %s\n' "$*"; }
fail() { printf '[selftest] FAIL: %s\n' "$*" >&2; failures=$((failures + 1)); }
# expect <0|1> <description> <command…>: the command must exit with that status.
expect() {
  want="$1"; what="$2"; shift 2
  set +e; out=$("$@" 2>&1); got=$?; set -e
  if [ "$got" = "$want" ]; then pass "$what"; else fail "$what (exit $got, wanted $want)"; printf '%s\n' "$out" | sed 's/^/    /'; fi
  last_output="$out"
}

# 1. RLS coverage: main passes; a missing _rls.sql fails naming the table; an unlisted table fails.
expect 0 "check-rls passes on the current migrations" sh "$root/scripts/check-rls.sh" "$tmp/backend/drizzle" "$tmp/scripts/rls-allowlist.txt"
rm "$tmp/backend/drizzle/0077_timesheet_rls.sql"
expect 1 "check-rls fails when a _rls.sql migration is missing" sh "$root/scripts/check-rls.sh" "$tmp/backend/drizzle" "$tmp/scripts/rls-allowlist.txt"
case "$last_output" in *"time_entries"*) pass "…and names the table (time_entries)";; *) fail "…but does not name time_entries";; esac
cp "$root/backend/drizzle/0077_timesheet_rls.sql" "$tmp/backend/drizzle/"
printf 'CREATE TABLE "widgets" (\n\t"id" uuid PRIMARY KEY NOT NULL,\n\t"name" text NOT NULL\n);\n' > "$tmp/backend/drizzle/0900_widgets.sql"
expect 1 "check-rls fails on a new table that is neither protected nor allowlisted" sh "$root/scripts/check-rls.sh" "$tmp/backend/drizzle" "$tmp/scripts/rls-allowlist.txt"
case "$last_output" in *"widgets"*) pass "…and names the table (widgets)";; *) fail "…but does not name widgets";; esac
rm "$tmp/backend/drizzle/0900_widgets.sql"

# 2. Migration safety: DROP COLUMN fails; the same files pass with a migration-plan: section;
#    SET NOT NULL fails without a default and passes with one.
cat > "$tmp/backend/drizzle/0901_contract.sql" <<'SQL'
ALTER TABLE "deals" DROP COLUMN "amount";--> statement-breakpoint
ALTER TABLE "deals" RENAME COLUMN "title" TO "name";
SQL
export GUARD_ROOT="$tmp"
expect 1 "check-migrations fails on DROP COLUMN and RENAME COLUMN" env GUARD_FILES="backend/drizzle/0901_contract.sql" PR_BODY="" sh "$root/scripts/check-migrations.sh"
case "$last_output" in *"DROP COLUMN"*"RENAME COLUMN"*) pass "…and lists both statements";; *) fail "…but does not list both statements";; esac
expect 0 "check-migrations accepts the same files with a migration-plan: section in the description" env GUARD_FILES="backend/drizzle/0901_contract.sql" PR_BODY="## What changed
…
## migration-plan:
Maintenance window Sunday 02:00; restore the pre-deploy backup on failure." sh "$root/scripts/check-migrations.sh"
cat > "$tmp/backend/drizzle/0902_not_null.sql" <<'SQL'
ALTER TABLE "deals" ADD COLUMN "priority" text;--> statement-breakpoint
ALTER TABLE "deals" ALTER COLUMN "priority" SET NOT NULL;
SQL
expect 1 "check-migrations fails on SET NOT NULL without a default" env GUARD_FILES="backend/drizzle/0902_not_null.sql" PR_BODY="" sh "$root/scripts/check-migrations.sh"
cat > "$tmp/backend/drizzle/0902_not_null.sql" <<'SQL'
ALTER TABLE "deals" ADD COLUMN "priority" text;--> statement-breakpoint
ALTER TABLE "deals" ALTER COLUMN "priority" SET DEFAULT 'normal';--> statement-breakpoint
ALTER TABLE "deals" ALTER COLUMN "priority" SET NOT NULL;
SQL
expect 0 "check-migrations passes SET NOT NULL when the column has a default" env GUARD_FILES="backend/drizzle/0902_not_null.sql" PR_BODY="" sh "$root/scripts/check-migrations.sh"
expect 0 "check-migrations passes an additive migration" env GUARD_FILES="backend/drizzle/0085_hour_limits.sql" PR_BODY="" sh "$root/scripts/check-migrations.sh"

# 3. Tenant isolation test: a new tenant table without a spec fails; naming it in a spec passes.
cat > "$tmp/backend/drizzle/0903_gadgets.sql" <<'SQL'
CREATE TABLE "gadgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL
);
SQL
expect 1 "check-tenant-tests fails on a new tenant table without an integration spec" env GUARD_FILES="backend/drizzle/0903_gadgets.sql" sh "$root/scripts/check-tenant-tests.sh"
case "$last_output" in *"gadgets"*) pass "…and names the table (gadgets)";; *) fail "…but does not name gadgets";; esac
printf "const tables = ['deals', 'gadgets'];\n" > "$tmp/backend/test/integration/tenant-isolation.spec.ts"
expect 0 "check-tenant-tests passes when a changed spec names the table" env GUARD_FILES="backend/drizzle/0903_gadgets.sql
backend/test/integration/tenant-isolation.spec.ts" sh "$root/scripts/check-tenant-tests.sh"
printf 'CREATE TABLE "settings_cache" (\n\t"key" text PRIMARY KEY NOT NULL\n);\n' > "$tmp/backend/drizzle/0904_cache.sql"
expect 0 "check-tenant-tests ignores a table without tenant_id" env GUARD_FILES="backend/drizzle/0904_cache.sql" sh "$root/scripts/check-tenant-tests.sh"

if [ "$failures" -ne 0 ]; then
  printf '[selftest] %d check(s) failed\n' "$failures" >&2
  exit 1
fi
echo "[selftest] all guard checks behave as required"
