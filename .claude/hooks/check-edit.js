// PostToolUse on Edit|Write (CD-310): after a TypeScript file changes, lint it, typecheck its
// package and run the unit specs that import it. Problems come back to Claude as the hook's
// stderr (exit 2), so an unused variable or a type error is reported right after the edit
// instead of at `npm run lint` time. Integration tests need Postgres: those stay with CI.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { block, projectDir, readEvent, relativeToProject, run, tail, tool } = require('./lib');

const event = readEvent();
const file = relativeToProject(event.tool_input && event.tool_input.file_path);
if (!file || !/\.(ts|tsx|mts|cts)$/.test(file)) process.exit(0);

const pkg = ['backend', 'frontend', 'website', 'e2e'].find((p) => file.startsWith(`${p}/`));
if (!pkg) process.exit(0);
const root = projectDir();
const cwd = path.join(root, pkg);
// Not installed here (e.g. website/ on a backend-only checkout): nothing to run.
if (!['eslint', 'tsc'].every((t) => fs.existsSync(tool(cwd, t)))) process.exit(0);
const inPkg = file.slice(pkg.length + 1);
const problems = [];

// 1. ESLint on the file (the package's own config).
const lint = run('node', [tool(cwd, 'eslint'), '--no-warn-ignored', inPkg], cwd);
if (!lint.ok) problems.push(`ESLint (${pkg}):\n${tail(lint.output)}`);

// 2. Typecheck the package. The backend keeps an incremental build-info file in a gitignored
//    place, so the second run takes seconds; the frontend and website are `tsc -b` projects already.
const typecheck =
  pkg === 'backend' || pkg === 'e2e'
    ? run('node', [tool(cwd, 'tsc'), '-p', 'tsconfig.json', '--noEmit', '--incremental', '--tsBuildInfoFile', path.join(root, '.claude', 'hooks', '.cache', `${pkg}.tsbuildinfo`)], cwd)
    : run('node', [tool(cwd, 'tsc'), '-b'], cwd);
if (!typecheck.ok) problems.push(`tsc (${pkg}):\n${tail(typecheck.output)}`);

// 3. Backend unit specs that import the changed file (by its path without the extension).
if (pkg === 'backend' && inPkg.startsWith('src/')) {
  const target = inPkg.replace(/\.[mc]?ts$/, '').replace(/\/index$/, '');
  const testDir = path.join(cwd, 'test');
  const specs = fs.existsSync(testDir)
    ? fs.readdirSync(testDir).filter((f) => f.endsWith('.spec.ts') && fs.readFileSync(path.join(testDir, f), 'utf8').includes(`../${target}`))
    : [];
  if (specs.length) {
    const tests = run('node', [tool(cwd, 'vitest'), 'run', '--reporter=dot', ...specs.map((f) => `test/${f}`)], cwd, 180_000);
    if (!tests.ok) problems.push(`Unit tests (${specs.join(', ')}):\n${tail(tests.output, 6000)}`);
  }
}

if (problems.length) block(`Checks after editing ${file} found problems. Fix them before moving on.\n\n${problems.join('\n\n')}`);
