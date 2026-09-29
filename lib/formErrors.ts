// How a form's errors reach TanStack Form, and when a field shows one.
//
// Each form's rules live in lib/screens as one pure function over the whole
// draft, returning an error or null per field, so they're tested without a
// renderer. `draftValidator` hands those to the form; `visibleError` decides
// whether a field shows its error yet. The fields themselves are bound in
// components/native/form.tsx.

/** Per-field errors from a draft's rules. Null or undefined means none. */
export type DraftErrors<TErrors> = { [K in keyof TErrors]: string | null | undefined };

/**
 * A form-level validator from a draft's rules, for `validators.onMount` and
 * `validators.onChange`. It returns what TanStack Form reads as per-field
 * errors, or nothing when the draft is valid, so the form can't be saved
 * while any field has one.
 */
export const draftValidator =
  <TDraft, TErrors extends DraftErrors<TErrors>>(errorsOf: (draft: TDraft) => TErrors) =>
  ({ value }: { value: TDraft }): { fields: Record<string, string> } | undefined => {
    const fields: Record<string, string> = {};
    for (const [name, error] of Object.entries(errorsOf(value) as Record<string, string | null | undefined>)) {
      if (error) fields[name] = error;
    }
    return Object.keys(fields).length > 0 ? { fields } : undefined;
  };

export interface FieldMetaLike {
  errors: readonly unknown[];
  isTouched: boolean;
  isBlurred: boolean;
}

/**
 * The error a field shows, or null. By default it waits until the field has
 * been left once, or a save was tried, so nobody is told off mid-word; after
 * that it follows every change. `whileTyping` shows it from the first change,
 * for a rule worth knowing as you type, like a handle's allowed characters.
 */
export const visibleError = (meta: FieldMetaLike, submitted: boolean, whileTyping = false): string | null => {
  const shown = submitted || meta.isBlurred || (whileTyping && meta.isTouched);
  if (!shown) return null;
  const error = meta.errors.find((e): e is string => typeof e === 'string' && e !== '');
  return error ?? null;
};
