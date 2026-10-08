import { describe, expect, it } from 'vitest';
import { inSentence, projectCreatedEmail, taskAssignedEmail } from '../src/modules/projects/project-jobs';

const task = { id: 't1', number: 7, name: 'Replace the seal', project: 'Service 2026', company: 'Acme', dueDate: null };
const project = { id: 'p1', name: 'Service 2026', company: 'Acme', dealTitle: 'Acme service' };
const base = { to: 'ana@example.test', recipientName: 'Ana Petrović', workspaceName: 'WBM', appUrl: 'https://app.example.test/' };

describe('emails use the workspace names for projects and tasks (CD-143)', () => {
  it('keep Project and Task by default', () => {
    const m = taskAssignedEmail({ ...base, actorName: 'Marko', task });
    expect(m.subject).toBe('Assigned to a task: T-7 Replace the seal');
    expect(m.text).toContain('on the project Service 2026 for Acme.');
    expect(m.text).toContain('Open the task: https://app.example.test/tasks/t1');
  });

  it('use renamed ones, lower-cased inside a sentence, with the right article', () => {
    const m = taskAssignedEmail({ ...base, actorName: 'Marko', task, terms: { project: 'Job', task: 'Activity' } });
    expect(m.subject).toBe('Assigned to an activity: T-7 Replace the seal');
    expect(m.text).toContain('on the job Service 2026 for Acme.');
    expect(m.html).toContain('Open the activity');

    const p = projectCreatedEmail({ ...base, project, terms: { project: 'Work order', task: 'Step' } });
    expect(p.subject).toBe('Work order created from a won deal: Service 2026');
    expect(p.text).toContain('created the work order Service 2026 for Acme.');
  });

  it('keeps acronyms as they are', () => {
    expect(inSentence('RFQ')).toBe('RFQ');
    expect(inSentence('Work order')).toBe('work order');
  });
});
