// PreToolUse on Bash (CD-310): refuses the commands CLAUDE.md forbids, whatever the prompt says.
// Pushing to main, switching to main, merging pull requests and pushing the schema with
// drizzle-kit (migrations are generated and reviewed, never pushed).
'use strict';
const { block, readEvent } = require('./lib');

const event = readEvent();
const command = String((event.tool_input && event.tool_input.command) || '');
if (!command.trim()) process.exit(0);

// Each simple command on its own: `a && b`, `a; b`, `a | b`, newlines.
const simple = command.split(/\n|&&|\|\||;|\|/).map((c) => c.trim()).filter(Boolean);
const MAIN = /^(main|master)$/;
const REF_TO_MAIN = /^(.+:)?(main|master)$/; // `main`, `HEAD:main`, `feature:main`

for (const c of simple) {
  const words = c.split(/\s+/);
  const i = words.findIndex((w) => w === 'git' || w === 'gh' || /(^|\/)drizzle-kit$/.test(w));
  if (i < 0) continue;
  const tool = words[i].endsWith('drizzle-kit') ? 'drizzle-kit' : words[i];
  const args = words.slice(i + 1).filter((w) => !w.startsWith('-'));
  const [sub, ...rest] = args;

  if (tool === 'git' && sub === 'push' && rest.some((w) => REF_TO_MAIN.test(w))) {
    block(`Refused: "${c}" pushes to main. Everything reaches main through a pull request (CLAUDE.md). Push your issue branch instead.`);
  }
  if (tool === 'git' && (sub === 'checkout' || sub === 'switch') && rest.some((w) => MAIN.test(w))) {
    block(`Refused: "${c}" switches to main. Work on the issue branch; create it from origin/main with "git checkout -b <branch> origin/main".`);
  }
  if (tool === 'gh' && sub === 'pr' && rest[0] === 'merge') {
    block(`Refused: "${c}". Agents never merge pull requests; mark it ready for review and move the Linear issue to In Review.`);
  }
  if (tool === 'drizzle-kit' && sub === 'push') {
    block(`Refused: "${c}". Schema changes are migrations: "npm run db:generate", then a paired RLS migration and "npm run db:migrate" (see /new-tenant-table).`);
  }
}
