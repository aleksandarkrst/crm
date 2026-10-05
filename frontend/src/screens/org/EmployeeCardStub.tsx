import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Avatar } from '../../components/ui';
import { Screen } from '../../components/Layout';
import { paths } from '../../lib/paths';
import { initialsOfEmployee } from '../../store/people';
import { useStore } from '../../store/store';

/**
 * A stand-in for the employee card at /people/:id until CD-140's card screen replaces this route
 * (lane B): the directory's fields of one employee, so links from the Org structure page and
 * Ctrl/⌘K already land somewhere useful.
 */
export function EmployeeCardStub() {
  const { id = '' } = useParams();
  const { s, people } = useStore();
  const watch = people.watch;
  useEffect(() => watch(), [watch]);
  const e = s.people.employees.find((x) => x.id === id);
  return (
    <Screen title={e?.fullName ?? 'Employee'} parent={{ label: 'Org structure', to: paths.org() }}>
      <div className="card card-pad org-stub" data-testid="employee-card" data-id={id}>
        {e ? (
          <>
            <div className="org-stub-head">
              <Avatar initials={initialsOfEmployee(e)} size={40} font={14} />
              <div>
                <div className="card-title">{e.fullName}</div>
                <div className="card-sub">{e.jobTitle ?? ''}</div>
              </div>
            </div>
            <dl className="org-stub-fields">
              <dt>Department</dt>
              <dd>{e.departmentName ?? '—'}</dd>
              <dt>Team</dt>
              <dd>{e.teamName ?? '—'}</dd>
              <dt>Reports to</dt>
              <dd>{e.managerId ? <Link to={paths.employee(e.managerId)}>{e.managerName}</Link> : '—'}</dd>
              <dt>Work email</dt>
              <dd>{e.workEmail ?? '—'}</dd>
              <dt>Work phone</dt>
              <dd>{e.workPhone ?? '—'}</dd>
            </dl>
          </>
        ) : (
          <div className="empty-state">{s.people.loaded ? 'This employee is not in the directory.' : 'Loading…'}</div>
        )}
      </div>
    </Screen>
  );
}
