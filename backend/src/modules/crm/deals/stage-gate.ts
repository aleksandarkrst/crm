/**
 * The advance gate (CD-363), as plain rules: what stops an opportunity from moving forward out of
 * its stage. DealsService.moveToStage refuses a forward move (409) while this returns anything;
 * backward moves and Lost are never gated. The frontend shows the same reasons on the Advance button.
 */

export interface GateStage {
  id: string;
  name: string;
  position: number;
  isWon: boolean;
  gateTodos: boolean;
  gateDocsComplete: boolean;
  checklistItems: { id: string }[];
}

/** A deal_tasks row of this deal in this stage (playbook items, off-playbook to-dos, New task tasks). */
export interface GateTask {
  checklistItemId: string | null;
  offPlaybook: boolean;
  blocksAdvance: boolean;
  done: boolean;
}

export interface GateStageState {
  docsComplete: boolean;
}

/**
 * Why the deal can't leave `stage` forward. Open to-dos are the stage's checklist items without a
 * done row plus its off-playbook to-dos still open; "New task" tasks (blocksAdvance false) never count.
 */
export function advanceBlockers(input: { stage: GateStage; tasks: GateTask[]; stageState: GateStageState | null }): string[] {
  const { stage, tasks, stageState } = input;
  const out: string[] = [];
  if (stage.gateTodos) {
    const done = new Set(tasks.filter((t) => !t.offPlaybook && t.done && t.checklistItemId).map((t) => t.checklistItemId));
    const open = stage.checklistItems.filter((i) => !done.has(i.id)).length + tasks.filter((t) => t.offPlaybook && t.blocksAdvance && !t.done).length;
    if (open) out.push(`${open} ${open === 1 ? 'to-do' : 'to-dos'} open in ${stage.name}`);
  }
  if (stage.gateDocsComplete && !stageState?.docsComplete) out.push(`Documentation isn't marked complete in ${stage.name}`);
  return out;
}

/** A funnel has gates when any of its working stages has one switched on. */
export const funnelIsGated = (stages: GateStage[]): boolean => stages.some((s) => !s.isWon && (s.gateTodos || s.gateDocsComplete));

/**
 * Winning in a gated funnel (decided 24 Oct): only from the last stage before Won. Null when the
 * move into Won is allowed from `from` (the gates of `from` still apply on top).
 */
export function wonBlocker(from: GateStage, stages: GateStage[]): string | null {
  if (!funnelIsGated(stages)) return null;
  const working = stages.filter((s) => !s.isWon).sort((a, b) => a.position - b.position);
  const last = working[working.length - 1];
  return last && from.id !== last.id ? `Win it from ${last.name}, the last stage before Won` : null;
}

/**
 * A jump of two or more stages forward: refused when a stage in between has a gate on, so its gates
 * can't be skipped (found in review). Moves into Won use wonBlocker instead, which already asks for
 * the last stage in a gated funnel. Null when nothing in between is gated.
 */
export function skipBlocker(from: GateStage, to: GateStage, stages: GateStage[]): string | null {
  const between = stages.filter((s) => !s.isWon && s.position > from.position && s.position < to.position).sort((a, b) => a.position - b.position);
  const gated = between.find((s) => s.gateTodos || s.gateDocsComplete);
  return gated ? `Move it through ${gated.name} first` : null;
}

/** Days past the stage's target (else the funnel's), or 0 when on time or without a target. */
export function stageLateDays(stageEnteredAt: Date, targetDays: number | null, now: Date): number {
  if (!targetDays) return 0;
  const days = Math.floor((now.getTime() - stageEnteredAt.getTime()) / 86_400_000);
  return Math.max(0, days - targetDays);
}
