import { describe, expect, it } from 'vitest';
import { advanceBlockers, funnelIsGated, type GateStage, type GateTask, skipBlocker, stageLateDays, wonBlocker } from '../src/modules/crm/deals/stage-gate';

const stage = (over: Partial<GateStage> = {}): GateStage => ({
  id: 's1',
  name: 'Discovery call',
  position: 1,
  isWon: false,
  gateTodos: true,
  gateDocsComplete: false,
  checklistItems: [{ id: 'a' }, { id: 'b' }],
  ...over,
});
const playbook = (checklistItemId: string, done: boolean): GateTask => ({ checklistItemId, offPlaybook: false, blocksAdvance: true, done });
const extra = (done: boolean, blocksAdvance = true): GateTask => ({ checklistItemId: null, offPlaybook: true, blocksAdvance, done });

describe('advanceBlockers (CD-363)', () => {
  it('counts checklist items without a done row and open off-playbook to-dos', () => {
    expect(advanceBlockers({ stage: stage(), tasks: [], stageState: null })).toEqual(['2 to-dos open in Discovery call']);
    expect(advanceBlockers({ stage: stage(), tasks: [playbook('a', true)], stageState: null })).toEqual(['1 to-do open in Discovery call']);
    expect(advanceBlockers({ stage: stage(), tasks: [playbook('a', true), playbook('b', false)], stageState: null })).toEqual(['1 to-do open in Discovery call']);
    expect(advanceBlockers({ stage: stage(), tasks: [playbook('a', true), playbook('b', true), extra(false)], stageState: null })).toEqual(['1 to-do open in Discovery call']);
    expect(advanceBlockers({ stage: stage(), tasks: [playbook('a', true), playbook('b', true), extra(true)], stageState: null })).toEqual([]);
  });

  it('never counts New task tasks (blocksAdvance false)', () => {
    expect(advanceBlockers({ stage: stage({ checklistItems: [] }), tasks: [extra(false, false)], stageState: null })).toEqual([]);
  });

  it('ignores to-dos when the stage does not gate on them', () => {
    expect(advanceBlockers({ stage: stage({ gateTodos: false }), tasks: [extra(false)], stageState: null })).toEqual([]);
  });

  it('needs the documentation flag when the stage asks for it, in every combination', () => {
    for (const gateTodos of [true, false]) {
      for (const docsComplete of [true, false]) {
        const s = stage({ gateTodos, gateDocsComplete: true, checklistItems: [] });
        const got = advanceBlockers({ stage: s, tasks: [], stageState: { docsComplete } });
        expect(got, `todos ${gateTodos}, docs ${docsComplete}`).toEqual(docsComplete ? [] : ["Documentation isn't marked complete in Discovery call"]);
      }
    }
    expect(advanceBlockers({ stage: stage({ gateDocsComplete: true, checklistItems: [] }), tasks: [], stageState: null })).toEqual(["Documentation isn't marked complete in Discovery call"]);
  });

  it('lists both reasons when both gates fail', () => {
    expect(advanceBlockers({ stage: stage({ gateDocsComplete: true }), tasks: [], stageState: { docsComplete: false } })).toEqual([
      '2 to-dos open in Discovery call',
      "Documentation isn't marked complete in Discovery call",
    ]);
  });

  it('has no blockers without gates', () => {
    expect(advanceBlockers({ stage: stage({ gateTodos: false, gateDocsComplete: false }), tasks: [], stageState: null })).toEqual([]);
  });
});

describe('winning in a gated funnel (CD-363)', () => {
  const funnel = [
    stage({ id: 'new', name: 'New', position: 0, gateTodos: false }),
    stage({ id: 'prop', name: 'Proposal', position: 1, gateTodos: false }),
    stage({ id: 'neg', name: 'Negotiation', position: 2, gateTodos: false }),
    stage({ id: 'won', name: 'Won', position: 3, isWon: true, gateTodos: true }),
  ];

  it('is free in a funnel without gates (a Won stage\'s own switch does not count)', () => {
    expect(funnelIsGated(funnel)).toBe(false);
    expect(wonBlocker(funnel[0]!, funnel)).toBeNull();
  });

  it('only from the last stage before Won once any working stage is gated', () => {
    const gated = funnel.map((s) => (s.id === 'prop' ? { ...s, gateDocsComplete: true } : s));
    expect(funnelIsGated(gated)).toBe(true);
    expect(wonBlocker(gated[0]!, gated)).toBe('Win it from Negotiation, the last stage before Won');
    expect(wonBlocker(gated[1]!, gated)).toBe('Win it from Negotiation, the last stage before Won');
    expect(wonBlocker(gated[2]!, gated)).toBeNull();
  });
});

describe('skipping stages (CD-363)', () => {
  const funnel = [
    stage({ id: 'new', name: 'New', position: 0, gateTodos: false }),
    stage({ id: 'prop', name: 'Proposal', position: 1, gateTodos: false, gateDocsComplete: true }),
    stage({ id: 'neg', name: 'Negotiation', position: 2, gateTodos: false }),
    stage({ id: 'sign', name: 'Signing', position: 3, gateTodos: false }),
  ];

  it('refuses a jump over a gated stage, naming the first one', () => {
    expect(skipBlocker(funnel[0]!, funnel[2]!, funnel)).toBe('Move it through Proposal first');
    expect(skipBlocker(funnel[0]!, funnel[3]!, funnel)).toBe('Move it through Proposal first');
  });

  it('allows the next stage, and jumps over ungated stages', () => {
    expect(skipBlocker(funnel[0]!, funnel[1]!, funnel)).toBeNull();
    expect(skipBlocker(funnel[1]!, funnel[3]!, funnel)).toBeNull();
  });
});

describe('stageLateDays (CD-363)', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  it('counts whole days past the target', () => {
    expect(stageLateDays(new Date('2026-10-17T12:00:00Z'), 5, now)).toBe(2);
    expect(stageLateDays(new Date('2026-10-20T12:00:00Z'), 5, now)).toBe(0);
    expect(stageLateDays(new Date('2026-10-19T12:00:00Z'), 5, now)).toBe(0);
  });
  it('is never late without a target', () => {
    expect(stageLateDays(new Date('2020-01-01T00:00:00Z'), null, now)).toBe(0);
  });
});
