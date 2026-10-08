import type { WorkspaceTerms } from '../lib/api';
import { DEFAULT_TERMS } from './remote';
import { useStore } from './store';

/**
 * What the workspace calls projects and tasks (CD-143, Settings → Project types), in the forms the
 * screens need: "Project" / "Projects" to start a label, "project" / "projects" inside a sentence,
 * and "a task" / "an activity" with the right article.
 */
export interface Terms {
  Project: string;
  Projects: string;
  project: string;
  projects: string;
  aProject: string;
  /** "A project" / "An activity" to start a sentence. */
  AProject: string;
  Task: string;
  Tasks: string;
  task: string;
  tasks: string;
  aTask: string;
  ATask: string;
}

/** "Work order" → "work order" inside a sentence; an acronym ("RFQ") stays as it is. */
export const inSentence = (term: string) => (/^[A-Z][^A-Z]/.test(term) ? term[0]!.toLowerCase() + term.slice(1) : term);
const withArticle = (word: string) => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;
const capital = (text: string) => text[0]!.toUpperCase() + text.slice(1);

export function termsOf(t: WorkspaceTerms = DEFAULT_TERMS): Terms {
  const project = inSentence(t.project);
  const task = inSentence(t.task);
  return {
    Project: t.project,
    Projects: t.projects,
    project,
    projects: inSentence(t.projects),
    aProject: withArticle(project),
    AProject: capital(withArticle(project)),
    Task: t.task,
    Tasks: t.tasks,
    task,
    tasks: inSentence(t.tasks),
    aTask: withArticle(task),
    ATask: capital(withArticle(task)),
  };
}

/** The workspace's names for projects and tasks; they change live when an admin renames them. */
export function useTerms(): Terms {
  return termsOf(useStore().s.workspace.terms);
}
