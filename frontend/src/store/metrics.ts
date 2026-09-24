/**
 * Conversion metrics for Overview (CD-62), computed from the stage history (CD-61) of the deals
 * in view, so every Overview filter applies to them the same way it applies to the other panels.
 */
import type { Lead, Stage, StageChange } from './types';

const DAY = 86_400_000;
/** Below this many deals that moved between stages, rates would mostly be noise. */
export const MIN_MOVED_DEALS = 5;

export interface StageConversion {
  stage: Stage;
  /** Deals that entered this stage. */
  reached: string[];
  /** Of those, deals that later entered a later stage. */
  advanced: string[];
  /** advanced / reached, 0–1; null when no deal reached the stage. */
  rate: number | null;
  /** Average days a deal spent in this stage per visit (visits still going count up to now). */
  avgDays: number | null;
}

export interface ConversionMetrics {
  /** Deals in view that moved between stages at least once. */
  moved: number;
  /** One row per stage except the last (nothing comes after it). */
  stages: StageConversion[];
  won: number;
  lost: number;
  /** won / (won + lost), 0–1; null without closed deals. */
  winRate: number | null;
  /** The stage treated as "proposal" (see proposalStageOf); null when the funnel has none. */
  proposal: Stage | null;
  /** Average days from entering the first stage to first entering the proposal stage. */
  toProposalDays: number | null;
  /** Deals that reached the proposal stage (the base of toProposalDays). */
  toProposalDeals: number;
}

/**
 * The proposal stage of a funnel: the first stage whose entry document is a Proposal (that is what
 * starts the proposal on entering it), else the stage keyed "proposal" by the funnel template.
 */
export function proposalStageOf(stages: Stage[]): Stage | null {
  return stages.find((st) => st.doc === 'Proposal') ?? stages.find((st) => st.key === 'proposal') ?? null;
}

const CHANGES_STAGE = new Set<StageChange['kind']>(['created', 'moved', 'funnel_changed']);

/**
 * `leads` are the deals in view in this funnel (lost ones included: they count as not moving on).
 * `history` is the workspace's stage history, oldest first.
 *
 * Stages deleted from the funnel (CD-9) aren't in `stages`, but the history still names them. A
 * visit to a deleted stage counts nowhere (its time isn't added to another stage), and a deal
 * that passed through it counts as having skipped it.
 */
export function conversionMetrics(stages: Stage[], leads: Lead[], history: StageChange[], now = Date.now()): ConversionMetrics {
  const position = new Map(stages.map((st, i) => [st.id, i]));
  const byDeal = new Map<string, StageChange[]>();
  for (const h of history) {
    const rows = byDeal.get(h.dealId);
    if (rows) rows.push(h);
    else byDeal.set(h.dealId, [h]);
  }

  const reached = stages.map(() => [] as string[]);
  const advanced = stages.map(() => [] as string[]);
  const daysSum = stages.map(() => 0);
  const visits = stages.map(() => 0);
  const proposal = proposalStageOf(stages);
  const proposalAt = proposal ? position.get(proposal.id)! : -1;
  let moved = 0;
  let toProposalSum = 0;
  let toProposalDeals = 0;

  for (const lead of leads) {
    const rows = byDeal.get(lead.id) ?? [];
    // Only the deal's path through this funnel: from the last time it entered it. The deal is in
    // this funnel, so that is its last "created" or "funnel_changed" row (which may name a stage
    // deleted since).
    let start = -1;
    for (let i = rows.length - 1; i >= 0; i--)
      if (rows[i]!.kind === 'created' || rows[i]!.kind === 'funnel_changed') {
        start = i;
        break;
      }
    if (start < 0) continue;
    const path = rows.slice(start);
    if (path.some((r) => r.kind === 'moved')) moved++;

    // Stage entries in order, and the time spent per visit (the clock stops while the deal is lost).
    const entries: { pos: number; at: number }[] = [];
    let running: number | null = null;
    let current = -1;
    const stop = (at: number) => {
      if (running === null || current < 0) return;
      daysSum[current]! += Math.max(0, at - running) / DAY;
      running = null;
    };
    for (const r of path) {
      if (CHANGES_STAGE.has(r.kind)) {
        const pos = position.get(r.toStageId);
        stop(r.at);
        if (pos === undefined) {
          // A stage deleted since: not tracked, and its time isn't counted anywhere.
          current = -1;
          running = null;
          continue;
        }
        current = pos;
        visits[pos]!++;
        entries.push({ pos, at: r.at });
        running = r.outcome === 'lost' ? null : r.at;
      } else if (r.kind === 'lost') stop(r.at);
      else if (r.kind === 'reopened' && running === null) running = r.at;
    }
    stop(now); // a deal that is still open is still in its stage

    // Reached a stage = entered it; moved on = entered a later stage after that.
    const first = new Map<number, number>(); // stage position → index of the first entry
    entries.forEach((e, i) => first.has(e.pos) || first.set(e.pos, i));
    for (const [pos, i] of first) {
      reached[pos]!.push(lead.id);
      if (entries.slice(i + 1).some((e) => e.pos > pos)) advanced[pos]!.push(lead.id);
    }
    const proposalEntry = first.get(proposalAt);
    if (proposalAt > 0 && proposalEntry !== undefined) {
      toProposalSum += (entries[proposalEntry]!.at - path[0]!.at) / DAY; // from entering the funnel
      toProposalDeals++;
    }
  }

  const won = leads.filter((l) => l.outcome === 'won').length;
  const lost = leads.filter((l) => l.outcome === 'lost').length;
  return {
    moved,
    stages: stages.slice(0, -1).map((stage, i) => ({
      stage,
      reached: reached[i]!,
      advanced: advanced[i]!,
      rate: reached[i]!.length ? advanced[i]!.length / reached[i]!.length : null,
      avgDays: visits[i] ? daysSum[i]! / visits[i]! : null,
    })),
    won,
    lost,
    winRate: won + lost ? won / (won + lost) : null,
    proposal,
    toProposalDays: toProposalDeals ? toProposalSum / toProposalDeals : null,
    toProposalDeals,
  };
}

/** "3.4 days", "1 day", or hours under a day. */
export function daysLabel(days: number | null): string {
  if (days === null) return '—';
  if (days < 1) return Math.round(days * 24) + ' h';
  const d = days < 10 ? Math.round(days * 10) / 10 : Math.round(days);
  return d + (d === 1 ? ' day' : ' days');
}
