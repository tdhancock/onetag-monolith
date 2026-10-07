import { formOptions } from '@tanstack/react-form';
import { draftValidator } from '../../lib/formErrors';
import { EMPTY_PROJECT_DRAFT, projectDraftErrors, type ProjectDraft } from '../../lib/screens/projects';

const validateProject = draftValidator(projectDraftErrors);

/**
 * What Add and Edit build their project form from: the draft's shape, and its
 * rules checked from the start and on every change. Each screen adds its own
 * starting draft and what saving does.
 *
 * Its own module so the form's parts, ProjectForm and ProjectDetailsFields,
 * share it without importing each other.
 */
export const projectFormOptions = formOptions({
  defaultValues: EMPTY_PROJECT_DRAFT as ProjectDraft,
  validators: { onMount: validateProject, onChange: validateProject },
});
