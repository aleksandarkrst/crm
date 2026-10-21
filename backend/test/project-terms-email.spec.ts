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
    expect(p.subject).toBe('Work order created from a won opportunity: Service 2026');
    expect(p.text).toContain('created the work order Service 2026 for Acme.');
  });

  it('keeps acronyms as they are', () => {
    expect(inSentence('RFQ')).toBe('RFQ');
    expect(inSentence('Work order')).toBe('work order');
  });
});

/** Subject, plain text and HTML with links removed: the words a person reads. Routes such as /projects/ stay out. */
const visibleProse = (mail: { subject: string; text: string; html: string }) => `${mail.subject}\n${mail.text}\n${mail.html}`.replace(/https?:\/\/\S+/g, '');

describe('project created email wording (CD-364)', () => {
  it('does not say deal in the subject or body', () => {
    const named = projectCreatedEmail({ ...base, project });
    const unnamed = projectCreatedEmail({ ...base, project: { ...project, dealTitle: null } });
    expect(named.subject).toBe('Project created from a won opportunity: Service 2026');
    expect(named.text).toContain('Acme service was won');
    expect(unnamed.text).toContain('Your opportunity was won');
    expect(unnamed.text).toContain('"Create a project when an opportunity is won"');
    expect(unnamed.html).toContain('Create a project when an opportunity is won');
    for (const mail of [named, unnamed]) expect(visibleProse(mail)).not.toMatch(/deal/i);
  });
});
