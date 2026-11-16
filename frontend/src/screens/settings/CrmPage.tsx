import { useEffect, useState } from 'react';
import { targetOf } from '../../lib/validate';
import { bonusRuleProblems } from '../../store/dealMath';
import { ACTIVITIES, CHANNEL_LABELS, CHANNELS, DOCS } from '../../store/seed';
import { currencySymbol, curOf, memberLabels, salesPeople } from '../../store/selectors';
import { useStore } from '../../store/store';
import type { BonusRule, Stage } from '../../store/types';
import { TemplatesSection } from '../DocumentTemplates';
import { Card, Preview, CheckButton, Confirm, Drawer, Dropdown, Row, RowMenu, Section, Segmented, Switch, Table, Tags, TextField, Unit } from './parts';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const TARGET_PROBLEM = 'Use whole days from 1 to 365, or leave it empty.';
const targetProblem = (v: string) => (targetOf(v, false) === undefined ? TARGET_PROBLEM : '');

/**
 * Workspace settings → CRM (CD-524 spec 2, design G-Settings-CRM): Funnels (a table; a funnel is
 * edited in the side drawer), Document templates and Sales bonuses. Not built because the app
 * doesn't have them: Lost reasons as a list, the default funnel (Make default) and Duplicate.
 * Custom fields are hidden with the spec (commented out below).
 */
export function CrmPage() {
  const { canSeeBonuses } = useStore();
  return (
    <>
      <FunnelsSection />
      <TemplatesSection />
      {canSeeBonuses && <BonusesSection />}
      {/* Custom fields are hidden in this spec (CD-524). They come back as a CRM section:
      <Section title="Custom fields" desc="Custom fields show on opportunities, companies and contacts."><FieldsTab /></Section> */}
    </>
  );
}

/** CRM → Funnels: the funnels as a table with a ⋯ menu; Edit opens the drawer, Delete confirms. */
function FunnelsSection() {
  const store = useStore();
  const { s, set } = store;
  const editable = store.canEditFunnels;
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const funnels = Object.values(s.funnels);
  const dealsIn = (id: string) => s.leads.filter((l) => l.segment === id).length;
  const open = (id: string) => {
    // The stage actions work on the selected funnel, which is also the Pipeline's (as before).
    set({ segment: id });
    setEditing(id);
  };
  // New funnel (CD-524 review): a draft in the drawer; nothing is saved until Create funnel.
  const [adding, setAdding] = useState(false);
  const doomed = deleting ? s.funnels[deleting] : null;
  const doomedDeals = deleting ? dealsIn(deleting) : 0;
  return (
    <Section
      title="Funnels"
      desc="The stages opportunities move through. Open a funnel to edit its stages."
      action={
        editable && (
          <button type="button" className="gs-btn primary" data-testid="new-funnel" onClick={() => setAdding(true)}>
            New funnel
          </button>
        )
      }
      testId="funnel-builder"
    >
      {!editable && <span className="gs-sub" data-testid="funnels-read-only">Only owners and admins can change funnels, stages and their to-dos.</span>}
      <Table cols={[{ label: 'Funnel' }, { label: 'Stages' }, { label: '', align: 'end' }]} minWidth={520}>
        {funnels.map((f) => (
          <tr key={f.id} data-testid="funnel-choice" data-funnel={f.id}>
            <td>
              <b>{f.label}</b>
            </td>
            <td className="gs-sub" style={{ fontSize: 13.5 }}>
              {f.stages.map((st) => st.name).join(', ')}
            </td>
            <td className="end">
              <RowMenu
                label={`Actions for ${f.label}`}
                testId="funnel-menu"
                items={[
                  { label: editable ? 'Edit' : 'Open', onClick: () => open(f.id), testId: 'funnel-edit' },
                  ...(editable && funnels.length > 1 ? [{ label: 'Delete', onClick: () => setDeleting(f.id), danger: true, testId: 'delete-funnel' }] : []),
                ]}
              />
            </td>
          </tr>
        ))}
      </Table>
      {editing && s.funnels[editing] && <FunnelDrawer onClose={() => setEditing(null)} />}
      {adding && <NewFunnelDrawer onClose={() => setAdding(false)} />}
      {doomed && (
        <Confirm
          title={`Delete ${doomed.label}?`}
          text={
            doomedDeals
              ? `${plural(doomedDeals, 'opportunity uses', 'opportunities use')} it. Move them to another funnel from the Pipeline first; then it can be deleted.`
              : `Nothing uses it. Its ${plural(doomed.stages.length, 'stage')}, their activities and to-dos are deleted and cannot be restored.`
          }
          confirmLabel="Delete funnel"
          blocked={doomedDeals > 0}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            void store.deleteFunnel(doomed.id);
            setDeleting(null);
          }}
          testId="delete-funnel-confirm"
        />
      )}
    </Section>
  );
}

/**
 * The funnel editor (CD-524 spec, design G-Settings-FunnelEdit): the name and how they buy edited in
 * the header, default target days, proposal approval, and the stages: one row each with its chips;
 * a click opens it in place (one at a time). Everything saves as it changes; Done, Escape or the
 * scrim close it.
 */
function FunnelDrawer({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const { s } = store;
  const funnel = s.funnels[s.segment]!;
  const stages = funnel.stages;
  const editable = store.canEditFunnels;
  const [open, setOpen] = useState<string | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [name, setName] = useState(funnel.label);
  const [nameTried, setNameTried] = useState(false);
  const [note, setNote] = useState(funnel.note);
  // Dragging a stage moves it one step per render (the store reads its own state after each move).
  const [moving, setMoving] = useState<{ from: number; to: number } | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const order = stages.map((st) => st.id).join();
  useEffect(() => {
    if (!moving || moving.from === moving.to) return setMoving(null);
    const dir = moving.to > moving.from ? 1 : -1;
    store.moveStage(moving.from, dir);
    setMoving({ from: moving.from + dir, to: moving.to });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs again once the order has changed
  }, [order, moving?.to]);
  const wonIdx = stages.findIndex((st) => st.won);
  const lastMovable = wonIdx === stages.length - 1 ? stages.length - 2 : stages.length - 1;
  const probs = stages.map((st) => (st.won ? 100 : Number(st.prob) || 0));
  const lowerThanBefore = (i: number) => i > 0 && !stages[i]!.won && probs[i]! < probs[i - 1]!;
  const members = [...memberLabels(s)].sort((a, b) => a[1].localeCompare(b[1]));
  const nameBad = nameTried && !name.trim();
  const saveName = () => {
    if (!name.trim()) return setNameTried(true);
    if (name.trim() !== funnel.label) store.patchFunnel(funnel.id, { label: name.trim() });
  };

  return (
    <Drawer
      label={funnel.label}
      onClose={onClose}
      testId="funnel-card"
      head={
        <>
          <input
            className="gs-drawer-title"
            aria-label="Funnel name"
            aria-invalid={nameBad}
            value={name}
            disabled={!editable}
            onChange={(e) => {
              setName(e.target.value);
              if (e.target.value.trim()) setNameTried(false);
            }}
            onBlur={saveName}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          {nameBad && (
            <span className="gs-error" role="alert">
              Give the funnel a name.
            </span>
          )}
          <input className="gs-drawer-line" aria-label="How they buy" placeholder="How they buy, in one line" value={note} disabled={!editable} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== funnel.note && store.patchFunnel(funnel.id, { note })} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
        </>
      }
    >
      <Card>
        <Row label="Default target days" desc="How long an opportunity may sit in a stage before it is flagged as stuck. A stage can set its own.">
          <TextField label="Default target days" testId="funnel-target-days" width={90} inputMode="numeric" placeholder="None" value={funnel.targetDays == null ? '' : String(funnel.targetDays)} validate={targetProblem} disabled={!editable} onSave={(v) => store.patchFunnel(funnel.id, { targetDays: targetOf(v, false) ?? null })} />
          <Unit>days</Unit>
        </Row>
        <Row label="Proposals need approval" desc={funnel.proposalApproval ? 'Proposals wait for the approver before they can be sent' : 'Off: proposals go out as soon as they are generated'} switchRow testId="funnel-approval">
          <Switch on={funnel.proposalApproval} disabled={!editable} label="Proposals in this funnel need approval before they are sent" onChange={(on) => store.patchFunnel(funnel.id, { proposalApproval: on })} />
        </Row>
        {funnel.proposalApproval && (
          // The approver is needed for approval to work (CD-120), so it stays as a row under the switch.
          <Row label="Approver" sub error={!funnel.approverId ? 'Pick the approver to switch approval on.' : undefined}>
            <Dropdown label="Approver" testId="funnel-approver" width={220} disabled={!editable} value={funnel.approverId ?? ''} options={[{ value: '', label: 'Pick the approver' }, ...members.map(([id, n]) => ({ value: id, label: n }))]} onChange={(v) => store.patchFunnel(funnel.id, { approverId: v || null })} />
          </Row>
        )}
      </Card>

      <div className="gs-block">
        <div className="gs-block-head">
          <div className="text">
            <h3>Stages</h3>
            <span className="gs-sub">Opportunities move from top to bottom. Click a stage to edit it.</span>
          </div>
          {editable && (
            <div className="actions">
              <button type="button" className="gs-btn" data-testid="add-stage" onClick={store.addStage}>
                New stage
              </button>
            </div>
          )}
        </div>
        <div className="gs-card gs-glass gs-stages">
          {stages.map((st, idx) => {
            const isOpen = open === st.id;
            const movable = editable && !st.won;
            return (
              <div key={st.id} className={'gs-stage' + (isOpen ? ' on' : '') + (st.won ? ' won' : '')} data-testid="funnel-stage" data-open={isOpen || undefined}>
                <div
                  className={'gs-stage-row' + (dropAt === idx && dragFrom !== null && dragFrom !== idx ? ' drop' : '')}
                  onDragOver={(e) => {
                    if (dragFrom === null || idx > lastMovable) return;
                    e.preventDefault();
                    setDropAt(idx);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragFrom !== null && dragFrom !== idx && idx <= lastMovable) setMoving({ from: dragFrom, to: idx });
                    setDragFrom(null);
                    setDropAt(null);
                  }}
                >
                  <span
                    className="gs-grip"
                    draggable={movable}
                    aria-hidden="true"
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', st.id);
                      setDragFrom(idx);
                    }}
                    onDragEnd={() => {
                      setDragFrom(null);
                      setDropAt(null);
                    }}
                    style={movable ? undefined : { visibility: 'hidden' }}
                  >
                    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
                      <circle cx="2" cy="2" r="1.4" />
                      <circle cx="8" cy="2" r="1.4" />
                      <circle cx="2" cy="7" r="1.4" />
                      <circle cx="8" cy="7" r="1.4" />
                      <circle cx="2" cy="12" r="1.4" />
                      <circle cx="8" cy="12" r="1.4" />
                    </svg>
                  </span>
                  <button type="button" className="gs-stage-main" aria-expanded={isOpen} data-testid="funnel-stage-toggle" onClick={() => setOpen(isOpen ? null : st.id)}>
                    <span className="gs-stage-n">{idx + 1}</span>
                    <span className="gs-stage-name">{st.name}</span>
                    <span className="gs-stage-chips">
                      <span className={'gs-sc' + (lowerThanBefore(idx) ? ' bad' : '')} title={lowerThanBefore(idx) ? 'Lower than the stage before' : 'Win probability'}>
                        {probs[idx]}%
                      </span>
                      {!st.won && st.gateTodos && (
                        <span className="gs-sc amber" title="All to-dos must be done before moving on">
                          To-dos first
                        </span>
                      )}
                      {!st.won && st.gateDocs && (
                        <span className="gs-sc blue" title="Documentation must be complete before moving on">
                          Document first
                        </span>
                      )}
                      {st.won && (
                        <span className="gs-sc green" title="The won stage">
                          Won
                        </span>
                      )}
                    </span>
                  </button>
                  <span className="gs-stage-menu">
                    {movable && (
                      <RowMenu
                        label={`Actions for ${st.name}`}
                        items={[
                          ...(idx > 0 ? [{ label: 'Move up', onClick: () => store.moveStage(idx, -1) }] : []),
                          ...(idx < lastMovable ? [{ label: 'Move down', onClick: () => store.moveStage(idx, 1) }] : []),
                          ...(stages.length > 1 ? [{ label: 'Delete', onClick: () => setRemoving(idx), danger: true, testId: 'remove-stage' }] : []),
                        ]}
                      />
                    )}
                  </span>
                </div>
                {isOpen && <StageEditor idx={idx} stage={st} editable={editable} defaultTarget={funnel.targetDays ?? null} lowerThan={lowerThanBefore(idx) ? { name: stages[idx - 1]!.name, prob: probs[idx - 1]! } : null} members={members} />}
              </div>
            );
          })}
        </div>
      </div>
      {removing !== null && stages[removing] && <RemoveStage idx={removing} onClose={() => setRemoving(null)} />}
    </Drawer>
  );
}

/** The default stages a funnel starts with when it copies none: a copy of the API's BLANK_FUNNEL_STAGES (backend default-funnels.ts), shown as the preview. */
const DEFAULT_STAGES = ['New opportunity', 'Discovery', 'Proposal', 'Won'];

/**
 * New funnel (CD-524 review): the same drawer as Edit, as a draft. Name, how they buy and the
 * stages to start from; nothing is saved until Create funnel. Cancel, the X, Escape or the scrim
 * discard it. Its stages are edited afterwards with Edit, like any funnel's.
 */
function NewFunnelDrawer({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const { s } = store;
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [from, setFrom] = useState('blank');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const nameBad = tried && !name.trim();
  const sources = [{ value: 'blank', label: 'Default stages' }, ...Object.values(s.funnels).map((f) => ({ value: f.id, label: `Copy ${f.label}` }))];
  const preview = from === 'blank' ? DEFAULT_STAGES : (s.funnels[from]?.stages.map((st) => st.name) ?? DEFAULT_STAGES);
  const create = async () => {
    setTried(true);
    if (!name.trim()) return;
    setBusy(true);
    const id = await store.createFunnel({ label: name, note, copyFrom: from }, (label) => `${label} created`);
    if (id) onClose();
    else setBusy(false);
  };
  return (
    <Drawer
      label="New funnel"
      onClose={onClose}
      testId="new-funnel-drawer"
      head={
        <>
          <input
            className="gs-drawer-title"
            aria-label="Funnel name"
            aria-invalid={nameBad}
            placeholder="Funnel name"
            value={name}
            data-testid="new-funnel-name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
          />
          {nameBad && (
            <span className="gs-error" role="alert">
              Give the funnel a name.
            </span>
          )}
          <input className="gs-drawer-line" aria-label="How they buy" placeholder="How they buy, in one line" value={note} onChange={(e) => setNote(e.target.value)} />
        </>
      }
      foot={
        <>
          <button type="button" className="gs-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="gs-btn primary" data-testid="new-funnel-create" disabled={busy} onClick={() => void create()}>
            Create funnel
          </button>
        </>
      }
    >
      <div className="gs-label">
        Start from
        <span className="gs-move" role="radiogroup" aria-label="Start from">
          {sources.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={o.value === from} className={o.value === from ? 'on' : ''} onClick={() => setFrom(o.value)}>
              {o.label}
            </button>
          ))}
        </span>
      </div>
      <div className="gs-label">
        Stages
        <Preview names={preview} testId="new-funnel-stages" />
        <span className="gs-sub">{from === 'blank' ? 'A small set to build on.' : 'A copy of its stages and their to-dos, without its opportunities.'} You can change the stages after the funnel is created.</span>
      </div>
    </Drawer>
  );
}

/** One stage, open in place: its fields in two columns, its to-dos as tags, and the checks before moving on. */
function StageEditor({ idx, stage: st, editable, defaultTarget, lowerThan, members }: { idx: number; stage: Stage; editable: boolean; defaultTarget: number | null; lowerThan: { name: string; prob: number } | null; members: [string, string][] }) {
  const store = useStore();
  const [pending, setPending] = useState<{ at: number; label: string } | null>(null);
  useEffect(() => {
    if (!pending || st.checklist.length <= pending.at) return;
    store.renameGate(idx, pending.at, pending.label);
    setPending(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the new to-do arrives
  }, [st.checklist.length, pending]);
  const opts = (list: readonly string[]) => list.map((o) => ({ value: o, label: o }));
  const probProblem = (v: string) => {
    const n = Number(v);
    if (v.trim() === '' || !Number.isFinite(n) || n < 0 || n > 100) return 'Use a number from 0 to 100.';
    return '';
  };
  return (
    <div className="gs-stage-edit">
      <div className="gs-fgrid">
        <label className="gs-ff wide">
          <span className="lab">Name</span>
          <TextField label="Stage name" width="100%" value={st.name} disabled={!editable} validate={(v) => (v.trim() ? '' : 'Give the stage a name.')} onSave={(v) => store.editStage(idx, 'name', v.trim())} small={false} />
        </label>
        <div className="gs-ff">
          <span className="lab">Activity</span>
          <Dropdown label="Activity" width="100%" value={st.activity} options={opts(ACTIVITIES)} disabled={!editable} onChange={(v) => store.editStage(idx, 'activity', v)} />
        </div>
        <div className="gs-ff">
          <span className="lab">Channel</span>
          <Dropdown label="Channel" width="100%" value={st.channel} options={CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABELS[c] }))} disabled={!editable} onChange={(v) => store.editStage(idx, 'channel', v)} />
        </div>
        <div className="gs-ff">
          <span className="lab">Document on entry</span>
          <Dropdown label="Document on entry" width="100%" value={st.doc} options={opts(DOCS)} disabled={!editable} onChange={(v) => store.editStage(idx, 'doc', v)} />
        </div>
        <div className="gs-ff">
          <span className="lab">Stage owner</span>
          <Dropdown label="Stage owner" testId="stage-owner-select" width="100%" value={st.ownerId ?? ''} options={[{ value: '', label: "The opportunity's owner" }, ...members.map(([id, n]) => ({ value: id, label: n }))]} disabled={!editable || st.won} onChange={(v) => store.setStageRule(idx, { ownerId: v || null })} />
        </div>
        <div className="gs-ff">
          <span className="lab">Win probability</span>
          {st.won ? (
            <span className="gs-unit" style={{ lineHeight: '36px' }}>
              100%, always on the won stage
            </span>
          ) : (
            <>
              <span className="ctl">
                <TextField label="Win probability" width={90} inputMode="numeric" value={String(st.prob)} disabled={!editable} validate={probProblem} onSave={(v) => store.editProb(idx, v)} small={false} />
                <Unit>%</Unit>
              </span>
              {lowerThan && (
                <span className="gs-error" role="alert">
                  Lower than {lowerThan.name} ({lowerThan.prob}%). Win probability should rise from stage to stage.
                </span>
              )}
            </>
          )}
        </div>
        <div className="gs-ff">
          <span className="lab">Target days</span>
          {st.won ? (
            <span className="gs-unit" style={{ lineHeight: '36px' }}>
              Not used on the won stage
            </span>
          ) : (
            <span className="ctl">
              <TextField label="Target days" testId="stage-target-days" width={90} inputMode="numeric" placeholder={defaultTarget ? String(defaultTarget) : 'None'} value={st.targetDays == null ? '' : String(st.targetDays)} validate={targetProblem} disabled={!editable} onSave={(v) => store.setStageRule(idx, { targetDays: targetOf(v, false) ?? null })} small={false} />
              <Unit>days</Unit>
            </span>
          )}
        </div>
      </div>
      <div className="gs-ff">
        <span className="lab">To-dos</span>
        <Tags
          items={st.checklist.map((c, gi) => ({ key: st.checklistIds[gi] ?? String(gi), label: c }))}
          disabled={!editable}
          addLabel="Add"
          empty="No to-dos yet."
          onRemove={(gi) => store.removeGate(idx, gi)}
          onRename={(gi, v) => store.renameGate(idx, gi, v)}
          onAdd={(label) => {
            // A new to-do comes in as "New to-do"; it gets what was typed once it is there (below).
            setPending({ at: st.checklist.length, label });
            store.addGate(idx);
          }}
        />
      </div>
      {!st.won && (
        <div className="gs-ff">
          <span className="lab">Checks before moving on</span>
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <CheckButton on={st.gateTodos} label="All to-dos done" disabled={!editable || !st.checklist.length} title={!st.checklist.length ? 'Add a to-do first' : undefined} onChange={(on) => store.setStageRule(idx, { gateTodos: on })} />
            <CheckButton on={st.gateDocs} label="Document attached" disabled={!editable} onChange={(on) => store.setStageRule(idx, { gateDocs: on })} />
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Deleting a stage (CD-9): its opportunities, lost ones included, move to the stage picked here
 * (the next one preselected); the move shows in their history. Lost ones can't go to the won stage.
 */
function RemoveStage({ idx, onClose }: { idx: number; onClose: () => void }) {
  const store = useStore();
  const { s } = store;
  const stages = s.funnels[s.segment]!.stages;
  const st = stages[idx]!;
  const deals = s.leads.filter((l) => l.stage === st.id);
  const hasLost = deals.some((l) => l.outcome === 'lost');
  const targets = stages.filter((x) => x.id !== st.id && !(hasLost && x.won));
  const preferred = stages[idx + 1] && targets.includes(stages[idx + 1]!) ? stages[idx + 1]! : targets[0];
  const [target, setTarget] = useState(preferred?.id ?? '');
  return (
    <Confirm
      title={`Delete the ${st.name} stage?`}
      text={
        deals.length
          ? `${plural(deals.length, 'opportunity is', 'opportunities are')} in this stage. They move to the stage you pick, with their to-dos and history. Its own to-dos and checks are deleted.${hasLost ? " Lost ones can't go to the won stage." : ''}`
          : 'No opportunities are in this stage. Its to-dos and checks are deleted.'
      }
      confirmLabel="Delete stage"
      move={deals.length ? { label: 'Move them to', options: targets.map((x) => ({ value: x.id, label: x.name })), value: target, onPick: setTarget } : undefined}
      onCancel={onClose}
      onConfirm={() => {
        store.removeStage(idx, deals.length ? target : undefined);
        onClose();
      }}
      testId="remove-stage-confirm"
    />
  );
}

const BONUS_TRIGGERS = [
  { value: 'On contract signed', label: 'On contract signed' },
  { value: 'When fully billed', label: 'When fully billed' },
] as const;

/**
 * CRM → Sales bonuses (CD-17): when a bonus is earned, and each salesperson's rule (the spec was
 * updated on 16 Nov 2026 to keep the rules per person). Owners and admins only; the API returns 403
 * to members. Overview computes each salesperson's bonuses from these rules.
 */
function BonusesSection() {
  const { s, setBonusTrigger, setBonusRule } = useStore();
  const symbol = currencySymbol(curOf(s));
  const rules = s.bonusRules ?? {};
  const people = salesPeople(s).filter((p) => s.team.some((m) => m.status === 'Active' && m.id === p.value));
  return (
    <Section title="Sales bonuses" desc="How salespeople earn bonuses on won opportunities. Only owners and admins see this." testId="bonuses">
      <Card>
        <Row label="Bonus earned" desc="When a won opportunity counts toward a bonus">
          <Segmented label="Bonus earned" value={s.bonusTrigger as (typeof BONUS_TRIGGERS)[number]['value']} options={BONUS_TRIGGERS} onChange={(v) => setBonusTrigger(v)} />
        </Row>
      </Card>
      <Table
        cols={[{ label: 'Salesperson' }, { label: 'Rate %', align: 'num' }, { label: `Minimum (${symbol})`, align: 'num' }, { label: `Flat under min (${symbol})`, align: 'num' }]}
        minWidth={560}
        empty={people.length ? undefined : 'No active salespeople yet.'}
      >
        {people.map((p) => {
          const r = rules[p.value] ?? { rate: '', floor: '', fixed: '' };
          // A refused number stays in its field with a red message under it and is not saved (CD-479 QA).
          const bad = bonusRuleProblems(r);
          const field = (key: keyof BonusRule, label: string, width: number) => (
            <td className="num">
              <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <input className="gs-input s" aria-label={`${label} for ${p.label}`} inputMode="decimal" placeholder="0" aria-invalid={!!bad[key] || undefined} value={r[key]} onChange={(e) => setBonusRule(p.value, key, e.target.value)} style={{ width, textAlign: 'right' }} />
                {bad[key] && (
                  <span className="gs-error" role="alert" data-testid="bonus-error" style={{ maxWidth: 200, textAlign: 'right' }}>
                    {bad[key]}
                  </span>
                )}
              </span>
            </td>
          );
          return (
            <tr key={p.value} data-testid="bonus-rule">
              <td>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="gs-face soft">{p.label.split(/\s+/).map((w) => w[0]).slice(0, 2).join('')}</span>
                  <b>{p.label}</b>
                </span>
              </td>
              {field('rate', 'Rate', 72)}
              {field('floor', 'Minimum', 100)}
              {field('fixed', 'Flat amount', 100)}
            </tr>
          );
        })}
      </Table>
      <p className="gs-note">
        The rate applies to the net value of each won opportunity; below the minimum the flat amount is paid instead. The minimum and the flat amount are in {s.workspace.currency}; opportunities in another currency earn the rate only.
      </p>
    </Section>
  );
}
