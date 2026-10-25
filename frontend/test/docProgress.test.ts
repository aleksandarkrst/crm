// The estimated progress bar while a document is generated (CD-120). `npm test` in frontend.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { estimatedProgress } from '../src/store/docProgress.ts';

const at = Date.parse('2026-10-25T10:00:00Z');
const doc = (status: 'queued' | 'running' | 'ready' | 'failed', secondsAgo: number) => ({ status, createdAt: new Date(at - secondsAgo * 1000).toISOString() });

describe('estimatedProgress', () => {
  it('grows with time but stays below 100 % until the document is ready', () => {
    const steps = [0, 2, 10, 20, 60, 600].map((s) => estimatedProgress(doc('running', s), at));
    assert.deepEqual([...steps].sort((a, b) => a - b), steps);
    assert.equal(steps[0], 5);
    assert.ok(steps.at(-1)! < 100);
    assert.equal(estimatedProgress(doc('ready', 1), at), 100);
    assert.equal(estimatedProgress(doc('failed', 1), at), 100);
  });

  it('keeps a queued document in the first part of the bar', () => {
    assert.equal(estimatedProgress(doc('queued', 600), at), 20);
    assert.equal(estimatedProgress(doc('queued', 0), at), 0);
  });
});
