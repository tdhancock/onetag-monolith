// Where the next new project starts while linking blank tags (ONE-142).
//
// Tagging a house is a walk from sticker to sticker: the front door becomes
// Home, then the furnace, the AC and the water heater each become a project
// inside it. So a new project made while linking starts Part of the project
// the last tag went to — that project itself when it is at the top level, or
// the project it sits inside — and the walk never stops to pick Home again.
//
// UI state no server owns: held in memory for the session, never a query.

let next: string | null = null;

/** After a tag is linked to a project: where the next new project starts. */
export const rememberLinkedProject = (project: { id: string; parentProjectId: string | null }): void => {
  next = project.parentProjectId ?? project.id;
};

/** Part of, for the next new project made while linking: a project id, or null. */
export const partOfForNextNewProject = (): string | null => next;

/** Forget it, as signing out does. For tests. */
export const forgetLinkedProject = (): void => {
  next = null;
};
