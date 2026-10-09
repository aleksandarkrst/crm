// Shared bits for the hooks in this folder (CD-310). Plain CommonJS so `node` runs it anywhere
// without a build. Each hook reads the event JSON Claude Code pipes to stdin, decides, and either
// exits 0 (allow, optionally with JSON on stdout) or exits 2 with the reason on stderr (block;
// Claude sees the message).
'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');

/** The event JSON from stdin (`{}` when there is none). */
function readEvent() {
  try {
    const text = require('node:fs').readFileSync(0, 'utf8');
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/** The repository root: CLAUDE_PROJECT_DIR, else the folder above .claude/. */
const projectDir = () => path.resolve(process.env.CLAUDE_PROJECT_DIR || path.join(__dirname, '..', '..'));

/** `file` relative to the project root with forward slashes, or null when it is outside it. */
function relativeToProject(file) {
  if (!file) return null;
  const rel = path.relative(projectDir(), path.resolve(projectDir(), file)).split(path.sep).join('/');
  return rel.startsWith('..') ? null : rel;
}

/**
 * Runs a command in `cwd` and returns `{ ok, output }`; never throws. No shell: paths with spaces
 * stay one argument, and `.cmd` shims aren't needed because the hooks run tools through `node`.
 */
function run(cmd, args, cwd, timeoutMs = 120_000) {
  try {
    const output = execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs });
    return { ok: true, output };
  } catch (err) {
    return { ok: false, output: `${err.stdout || ''}${err.stderr || ''}`.trim() || String(err.message) };
  }
}

/** `node <package's own copy of a tool>`: eslint, tsc or vitest from `cwd`'s node_modules. */
function tool(cwd, name) {
  const entry = { eslint: 'eslint/bin/eslint.js', tsc: 'typescript/bin/tsc', vitest: 'vitest/vitest.mjs' }[name];
  return path.join(cwd, 'node_modules', entry);
}

/** Blocks the tool call: the reason goes to stderr and the exit code is 2. */
function block(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

/** The last `max` characters of `text`, so a long tool output stays readable. */
const tail = (text, max = 4000) => (text.length > max ? `…${text.slice(-max)}` : text);

module.exports = { block, projectDir, readEvent, relativeToProject, run, tail, tool };
