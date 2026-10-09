// PreToolUse on Edit|Write (CD-310): refuses edits to files that are generated, secret or
// already applied. `.env` files (not `.env.example`), lockfiles, drizzle's meta folder and any
// migration that is already tracked in git (applied somewhere; write a new one instead).
'use strict';
const path = require('node:path');
const { block, projectDir, readEvent, relativeToProject, run } = require('./lib');

const event = readEvent();
const file = relativeToProject(event.tool_input && event.tool_input.file_path);
if (!file) process.exit(0);

const base = path.posix.basename(file);
if (/^\.env(\..+)?$/.test(base) && base !== '.env.example') block(`${file} holds secrets and is not edited by agents. Change .env.example and tell the user what to set.`);
if (base === 'package-lock.json') block(`${file} is generated: run npm install in that package instead of editing the lockfile.`);
if (file.startsWith('backend/drizzle/meta/')) block(`${file} is drizzle-kit's bookkeeping: run "npm run db:generate" in backend instead of editing it.`);
if (/^backend\/drizzle\/[^/]+\.sql$/.test(file)) {
  const tracked = run('git', ['ls-files', '--error-unmatch', file], projectDir(), 10_000).ok;
  if (tracked) block(`${file} is a committed migration and may already be applied: never change it. Add a new migration (next number) instead; see docs/WORKFLOW.md "expand, then contract".`);
}
