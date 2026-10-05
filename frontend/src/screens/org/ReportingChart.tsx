import { memo } from 'react';
import type { TreeNode } from '../../store/people';
import { ChartFrame } from './ChartFrame';
import { PersonBox } from './parts';

export interface TreeView {
  /** Whether a node shows its reports. */
  isOpen: (node: TreeNode) => boolean;
  toggle: (node: TreeNode) => void;
  /** Filtered out: shown dimmed (spec 5.3: filters dim instead of hiding). Null: no filter. */
  matches: ReadonlySet<string> | null;
  /** Search hits, highlighted. */
  hits: ReadonlySet<string> | null;
  onOpen: (id: string) => void;
  hr: boolean;
}

const reportsLabel = (n: number) => (n === 1 ? '1 report' : `${n} reports`);

function Toggle({ node, view }: { node: TreeNode; view: TreeView }) {
  if (!node.children.length) return null;
  const open = view.isOpen(node);
  return (
    <button
      type="button"
      className="org-node-toggle"
      data-testid="org-node-toggle"
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} ${node.employee.fullName}'s ${reportsLabel(node.children.length)}`}
      onClick={() => view.toggle(node)}
    >
      {open ? '−' : '+'} {node.children.length}
    </button>
  );
}

function Person({ node, view }: { node: TreeNode; view: TreeView }) {
  const e = node.employee;
  return (
    <PersonBox
      e={e}
      onOpen={view.onOpen}
      hr={view.hr}
      sub={e.teamName}
      dim={!!view.matches && !view.matches.has(e.id)}
      hit={!!view.hits?.has(e.id)}
      extra={node.children.length > 0 ? <span className="org-reports" title={reportsLabel(node.children.length)}>{node.children.length}</span> : undefined}
    />
  );
}

/**
 * One node and, when open, its reports below it. People whose reports are all without reports of
 * their own are stacked in a column (a wide team would otherwise make the chart very wide).
 */
const Branch = memo(function Branch({ node, view }: { node: TreeNode; view: TreeView }) {
  const open = node.children.length > 0 && view.isOpen(node);
  const stack = open && node.children.length > 2 && node.children.every((c) => c.children.length === 0);
  return (
    <li className="org-branch" data-testid="org-node" data-id={node.employee.id}>
      <div className="org-node">
        <Person node={node} view={view} />
        <Toggle node={node} view={view} />
      </div>
      {open &&
        (stack ? (
          <div className="org-stack">
            {node.children.map((c) => (
              <div key={c.employee.id} className="org-stack-item" data-testid="org-node" data-id={c.employee.id}>
                <Person node={c} view={view} />
              </div>
            ))}
          </div>
        ) : (
          <ul>
            {node.children.map((c) => (
              <Branch key={c.employee.id} node={c} view={view} />
            ))}
          </ul>
        ))}
    </li>
  );
});

/** "Reporting lines" (spec 5.3): the tree from "reports to", several roots side by side. */
export function ReportingChart({ roots, view, focusKey }: { roots: TreeNode[]; view: TreeView; focusKey: string }) {
  if (!roots.length) return <div className="empty-state">Nobody to show.</div>;
  // The top of the tree in view, or the first search hit.
  const focus = view.hits?.size ? { selector: '.org-person.is-hit', key: focusKey, vertical: true } : { selector: '.org-tree > ul > li > .org-node', key: focusKey, vertical: false };
  return (
    <ChartFrame label="Reporting lines" focus={focus}>
      <div className="org-tree" data-testid="org-chart-reporting">
        <ul>
          {roots.map((r) => (
            <Branch key={r.employee.id} node={r} view={view} />
          ))}
        </ul>
      </div>
    </ChartFrame>
  );
}

/** Phones: manager → reports as an indented list; managers fold. */
export function ReportingList({ roots, view }: { roots: TreeNode[]; view: TreeView }) {
  if (!roots.length) return <div className="empty-state">Nobody to show.</div>;
  const rows: TreeNode[] = [];
  const walk = (n: TreeNode) => {
    rows.push(n);
    if (n.children.length && view.isOpen(n)) n.children.forEach(walk);
  };
  roots.forEach(walk);
  return (
    <div className="org-outline card" data-testid="org-chart-reporting">
      {rows.map((n) => (
        <div key={n.employee.id} className="org-outline-row" data-testid="org-node" data-id={n.employee.id} style={{ paddingLeft: 8 + Math.min(n.depth, 8) * 16 }}>
          <Person node={n} view={view} />
          <Toggle node={n} view={view} />
        </div>
      ))}
    </div>
  );
}
