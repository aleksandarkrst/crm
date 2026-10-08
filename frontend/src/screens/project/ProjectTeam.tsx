import { useEffect, useMemo, useState } from 'react';
import { Modal, ModalHeader } from '../../components/ui';
import { type ApiDirectoryRow, orgApi } from '../../lib/orgApi';
import { type ApiProjectMember, projectsApi } from '../../lib/projectsApi';
import { projectError } from '../../store/projects';
import { initialsOf } from '../../store/selectors';
import { useStore } from '../../store/store';

/** The hours-a-week choices (design v2). */
const HOURS = [0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40];

/** "32 h of 40 h", the share, and red over 100 % (design v2: "Load, all projects"). */
function load(m: ApiProjectMember) {
  const pct = m.weeklyHours > 0 ? Math.round((m.loadHours / m.weeklyHours) * 100) : 0;
  return { text: `${m.loadHours} h of ${m.weeklyHours} h · ${pct}%`, pct, over: pct > 100 };
}

/**
 * The Team tab (CD-271, design v2 §2): people from the org chart with their role on the project, the
 * hours a week they give it, and their load across every open project. The lead, owners and admins
 * add and remove people and change roles and hours; everyone else reads it. "Open" and "Remaining"
 * (their tasks) come with project tasks (CD-146).
 */
export function ProjectTeam({ projectId, team, canEdit, onChange }: { projectId: string; team: ApiProjectMember[] | null; canEdit: boolean; onChange: (team: ApiProjectMember[]) => void }) {
  const { flash } = useStore();
  const [adding, setAdding] = useState(false);

  const save = async (change: () => Promise<ApiProjectMember[]>, done?: string) => {
    try {
      onChange(await change());
      if (done) flash(done);
    } catch (err) {
      flash(projectError(err));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="project-team">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.45, flex: '1 1 280px' }}>People come from the org chart in Workforce. Load adds up weekly hours across all open projects.</span>
        {canEdit && (
          <button type="button" className="btn btn-primary" data-testid="add-people" onClick={() => setAdding(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add people
          </button>
        )}
      </div>
      <div className="pipeline-table">
        <div className="team-table-inner">
          <div className="table-head caps">
            <span>Person</span>
            <span>Team</span>
            <span>Project role</span>
            <span>Hours / week</span>
            <span>Load, all projects</span>
            <span />
          </div>
          {!team ? (
            <div className="pipeline-table-empty">Loading the team</div>
          ) : team.length === 0 ? (
            <div className="pipeline-table-empty">No one is on this project yet.</div>
          ) : (
            team.map((m) => {
              const l = load(m);
              return (
                <div key={m.employeeId} className="table-row" data-testid="team-row" data-employee={m.employeeId} style={{ paddingTop: 8, paddingBottom: 8 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                    <span className="avatar" style={{ width: 28, height: 28, flex: '0 0 28px', fontSize: 10.5, fontWeight: 600 }}>
                      {initialsOf(m.name)}
                    </span>
                    <span className="pt-cell">
                      <span className="pt-main" style={{ fontWeight: 600 }}>
                        {m.name}
                      </span>
                      <span className="pt-sub">{m.active ? (m.jobTitle ?? '') : 'Left the company'}</span>
                    </span>
                  </span>
                  <span className="pt-main" style={{ color: 'var(--text-2)' }}>
                    {m.team ?? '—'}
                  </span>
                  <RoleField value={m.role ?? ''} disabled={!canEdit} onSave={(role) => void save(() => projectsApi.updateMember(projectId, m.employeeId, { role: role || null }))} />
                  <select
                    className="ghost ghost-sm"
                    aria-label="Hours per week"
                    value={m.hoursPerWeek}
                    disabled={!canEdit}
                    onChange={(e) => void save(() => projectsApi.updateMember(projectId, m.employeeId, { hoursPerWeek: Number(e.target.value) }))}
                  >
                    {[...new Set([...HOURS, m.hoursPerWeek])]
                      .sort((a, b) => a - b)
                      .map((h) => (
                        <option key={h} value={h}>
                          {h} h
                        </option>
                      ))}
                  </select>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }} data-testid="team-load">
                    <span style={{ fontSize: 12.5, color: l.over ? 'var(--danger)' : 'var(--text-2)' }}>{l.text}</span>
                    <span style={{ height: 4, borderRadius: 2, background: 'var(--chip)', overflow: 'hidden' }}>
                      <span style={{ display: 'block', width: `${Math.min(100, l.pct)}%`, height: '100%', background: l.over ? 'var(--danger)' : 'var(--brand)' }} />
                    </span>
                  </span>
                  {canEdit ? (
                    <button type="button" className="icon-btn" aria-label="Remove from project" title="Remove from project" onClick={() => void save(() => projectsApi.removeMember(projectId, m.employeeId), `${m.name} removed from the project`)}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                        <path d="M6 6l12 12M18 6 6 18" />
                      </svg>
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
      {adding && (
        <AddPeopleDialog
          taken={new Set((team ?? []).map((m) => m.employeeId))}
          onClose={() => setAdding(false)}
          onAdd={async (ids) => {
            await save(() => projectsApi.addMembers(projectId, ids), ids.length === 1 ? 'Added to the project' : `${ids.length} people added to the project`);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function RoleField({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className="ghost ghost-sm"
      aria-label="Project role"
      placeholder="Role on this project"
      value={draft}
      disabled={disabled}
      maxLength={100}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== value && onSave(draft.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(value);
      }}
      style={{ minWidth: 0 }}
    />
  );
}

/** "Add people": active employees not on the team yet, searchable, several at once. */
function AddPeopleDialog({ taken, onClose, onAdd }: { taken: Set<string>; onClose: () => void; onAdd: (ids: string[]) => Promise<void> }) {
  const [people, setPeople] = useState<ApiDirectoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    orgApi
      .directory()
      .then((rows) => setPeople(rows.filter((r) => r.status !== 'inactive')))
      .catch((err: unknown) => setError(projectError(err)));
  }, []);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (people ?? []).filter((p) => !taken.has(p.id)).filter((p) => !needle || `${p.fullName} ${p.jobTitle ?? ''} ${p.unitName ?? ''}`.toLowerCase().includes(needle));
  }, [people, taken, q]);
  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Modal maxWidth={520} onBackdrop={onClose}>
      <ModalHeader title="Add people" sub="Pick people from the org chart. Set their role and hours a week on the Team tab." />
      <input className="form-input" autoFocus placeholder="Search by name, job title or team" value={q} onChange={(e) => setQ(e.target.value)} data-testid="add-people-search" />
      <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10 }} data-testid="add-people-list">
        {error ? (
          <div className="hint-box">{error}</div>
        ) : !people ? (
          <div style={{ padding: 14, fontSize: 13, color: 'var(--text-2)' }}>Loading people</div>
        ) : shown.length === 0 ? (
          <div style={{ padding: 14, fontSize: 13, color: 'var(--text-2)' }}>{taken.size && !q ? 'Everyone is on this project already.' : 'No one matches.'}</div>
        ) : (
          shown.map((p) => (
            <label key={p.id} data-employee={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--divider)', cursor: 'pointer' }}>
              <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
              <span className="avatar" style={{ width: 26, height: 26, flex: '0 0 26px', fontSize: 10, fontWeight: 600 }}>
                {initialsOf(p.fullName)}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>{p.fullName}</span>
                <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{[p.jobTitle, p.unitName].filter(Boolean).join(' · ')}</span>
              </span>
            </label>
          ))
        )}
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={picked.size && !saving ? 'btn btn-primary' : 'btn btn-disabled'}
          disabled={!picked.size || saving}
          data-testid="add-people-submit"
          onClick={async () => {
            setSaving(true);
            await onAdd([...picked]);
            setSaving(false);
          }}
        >
          {picked.size > 1 ? `Add ${picked.size} people` : 'Add to project'}
        </button>
      </div>
    </Modal>
  );
}
