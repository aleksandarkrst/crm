import { describe, expect, it } from 'vitest';
import { DEFAULT_FUNNELS } from '../src/modules/crm/funnels/default-funnels';

describe('DEFAULT_FUNNELS', () => {
  it.each(DEFAULT_FUNNELS.map((f) => [f.key, f] as const))('%s: unique stage keys, rising probability, ends in won', (_key, funnel) => {
    const keys = funnel.stages.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.at(-1)).toBe('won');

    const probs = funnel.stages.map((s) => s.winProbability);
    expect([...probs].sort((a, b) => a - b)).toEqual(probs);
    expect(probs.at(-1)).toBe(100);

    for (const s of funnel.stages) expect(s.checklist.length).toBeGreaterThan(0);
  });
});
