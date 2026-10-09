// Stop hook (CD-310): when Claude is about to end its turn with commits that aren't on GitHub, it
// is told so and keeps going (once: `stop_hook_active` is true on the retry, so this never loops).
// Uncommitted changes only get a status line: finishing a turn with edits in progress is normal.
'use strict';
const { projectDir, readEvent, run } = require('./lib');

const event = readEvent();
if (event.stop_hook_active) process.exit(0);
const root = projectDir();

const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], root, 10_000).output.trim();
const upstream = run('git', ['rev-parse', '--abbrev-ref', '@{u}'], root, 10_000);
const unpushed = upstream.ok ? run('git', ['log', '@{u}..HEAD', '--oneline'], root, 10_000).output.trim() : '';
const ahead = upstream.ok ? unpushed.split('\n').filter(Boolean).length : run('git', ['log', '--oneline', '-1'], root, 10_000).ok ? -1 : 0;
const dirty = run('git', ['status', '--porcelain', '--untracked-files=no'], root, 10_000).output.trim();

if (branch !== 'main' && (ahead > 0 || (ahead === -1 && branch !== 'HEAD'))) {
  const what = ahead > 0 ? `${ahead} commit(s) on ${branch} not pushed:\n${unpushed}` : `${branch} has no upstream yet`;
  const fix = ahead > 0 ? 'git push' : `git push -u origin ${branch}`;
  process.stdout.write(JSON.stringify({ decision: 'block', reason: `${what}\n\nCLAUDE.md: push after every commit so the work is visible and survives a stopped session. Run "${fix}" now, then finish.` }));
  process.exit(0);
}
if (dirty) {
  process.stdout.write(JSON.stringify({ systemMessage: `Uncommitted changes on ${branch}:\n${dirty.split('\n').slice(0, 10).join('\n')}` }));
}
