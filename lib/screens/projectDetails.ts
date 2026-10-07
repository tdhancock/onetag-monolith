// Project details (ONE-140), the pure logic: the four kinds, the templates an
// owner starts from, a detail as the form holds it and as it is saved, the
// rules each value is checked against, and how the project page shows one.
//
// The database checks the same rules (project_details_value_fits_kind), so a
// value the form lets through is one it stores.

import type { ProjectDetail, ProjectDetailEdit, ProjectDetailInput, ProjectDetailKind } from '../../features/projects';
import { newDraftKey } from './products';

export const DETAIL_LABEL_MAX_LENGTH = 40;
export const DETAIL_VALUE_MAX_LENGTH = 500;
/** Enough for a home's facts; a list longer than this wants nesting instead. */
export const PROJECT_DETAILS_MAX = 30;

// ─── Kinds ──────────────────────────────────────────────────────────────

/** The four kinds, in the order Add a detail offers them, each with what it is for. */
export const DETAIL_KINDS: { value: ProjectDetailKind; label: string; hint: string }[] = [
  { value: 'text', label: 'Text', hint: 'Words, like a model number' },
  { value: 'number', label: 'Number', hint: 'Like a capacity or mileage' },
  { value: 'date', label: 'Date', hint: 'Like when it was installed' },
  { value: 'link', label: 'Link', hint: 'Like a manual or a warranty page' },
];

export const detailKindLabel = (kind: ProjectDetailKind): string =>
  DETAIL_KINDS.find((option) => option.value === kind)?.label ?? 'Text';

// ─── Templates ──────────────────────────────────────────────────────────

export interface ProjectDetailTemplate {
  name: string;
  details: { label: string; kind: ProjectDetailKind }[];
}

/** "Installed:date" is a date detail named Installed; a label with no kind is text. */
const template = (name: string, ...entries: string[]): ProjectDetailTemplate => ({
  name,
  details: entries.map((entry) => {
    const [label, kind] = entry.split(':') as [string, ProjectDetailKind | undefined];
    return { label, kind: kind ?? 'text' };
  }),
});

/** What Start from a template offers, in order. */
export const PROJECT_DETAIL_TEMPLATES: ProjectDetailTemplate[] = [
  template('Home', 'Year built:number', 'Square feet:number'),
  template('HVAC', 'Make', 'Model number', 'Serial number', 'Filter size', 'Installed:date', 'Warranty until:date'),
  template('Appliance', 'Make', 'Model number', 'Serial number', 'Purchased:date', 'Warranty until:date'),
  template(
    'Water heater',
    'Make',
    'Model number',
    'Serial number',
    'Capacity (gal):number',
    'Installed:date',
    'Last flushed:date',
  ),
  template('Vehicle', 'Make', 'Model', 'Year:number', 'VIN', 'Mileage:number'),
];

/** A template's labels, as Start from a template lists them under its name. */
export const templateSummary = (chosen: ProjectDetailTemplate): string =>
  chosen.details.map((detail) => detail.label).join(', ');

// ─── A detail in the form ───────────────────────────────────────────────

/** A detail in the form. `id` when it is already stored; `value` as typed, or a date as YYYY-MM-DD. */
export interface ProjectDetailDraft {
  /** Stable across reordering, for list keys. */
  key: string;
  id?: string;
  label: string;
  kind: ProjectDetailKind;
  value: string;
}

/** A new, empty detail of a kind: Add a detail. */
export const newDetailDraft = (kind: ProjectDetailKind): ProjectDetailDraft => ({
  key: newDraftKey(),
  label: '',
  kind,
  value: '',
});

/** A template's labels with empty values, to fill in. Any left empty are never saved. */
export const detailDraftsFromTemplate = (chosen: ProjectDetailTemplate): ProjectDetailDraft[] =>
  chosen.details.map(({ label, kind }) => ({ key: newDraftKey(), label, kind, value: '' }));

/** Stored details as the edit form starts. */
export const detailDraftsFrom = (details: ProjectDetail[]): ProjectDetailDraft[] =>
  details.map(({ id, label, kind, value }) => ({ key: id, id, label, kind, value }));

// ─── Values ─────────────────────────────────────────────────────────────

const NUMBER = /^-?\d+(\.\d+)?$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LINK = /^https?:\/\/\S+$/;

/** Whether `value` is YYYY-MM-DD and a day that exists: 2026-02-30 is not. */
export const isCalendarDate = (value: string): boolean => {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    year >= 1 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
};

/**
 * A value as it is saved: trimmed, and a link given its scheme when it was
 * typed without one ("example.com/manual" becomes "https://example.com/manual"),
 * or with a capital one.
 */
export const savedDetailValue = (kind: ProjectDetailKind, value: string): string => {
  const trimmed = value.trim();
  if (kind !== 'link' || trimmed === '') return trimmed;
  const scheme = /^(https?):\/\//i.exec(trimmed);
  if (scheme) return scheme[1]!.toLowerCase() + trimmed.slice(scheme[1]!.length);
  return trimmed.includes('://') ? trimmed : `https://${trimmed}`;
};

/** What is wrong with a value of a kind, as saved, or null. An empty one is fine: it is not saved. */
export const detailValueError = (kind: ProjectDetailKind, value: string): string | null => {
  const saved = savedDetailValue(kind, value);
  if (saved === '') return null;
  if (saved.length > DETAIL_VALUE_MAX_LENGTH) return `At most ${DETAIL_VALUE_MAX_LENGTH} characters.`;
  switch (kind) {
    case 'number':
      return NUMBER.test(saved) ? null : 'A number, like 40 or 2.5.';
    case 'date':
      return isCalendarDate(saved) ? null : 'A date that exists, as YYYY-MM-DD.';
    case 'link':
      return LINK.test(saved) ? null : 'A web link, like https://example.com.';
    case 'text':
      return null;
  }
};

/**
 * What is wrong with each detail, keyed by its field in the form:
 * `details[2].value`. A detail with a value needs a label; one with neither is
 * just not saved.
 */
export const detailDraftErrors = (details: ProjectDetailDraft[]): Record<string, string | null> => {
  const errors: Record<string, string | null> = {};
  details.forEach((detail, index) => {
    const label = detail.label.trim();
    const hasValue = detail.value.trim() !== '';
    errors[`details[${index}].label`] =
      label.length > DETAIL_LABEL_MAX_LENGTH ? `At most ${DETAIL_LABEL_MAX_LENGTH} characters.` : null;
    errors[`details[${index}].value`] =
      detailValueError(detail.kind, detail.value) ?? (hasValue && label === '' ? 'Give this detail a label too.' : null);
  });
  return errors;
};

/** The details an edit saves, in order: every one with a value, trimmed. An empty value is never saved. */
export const detailEditsFrom = (details: ProjectDetailDraft[]): ProjectDetailEdit[] =>
  details
    .filter((detail) => detail.value.trim() !== '')
    .map(({ id, label, kind, value }) => ({
      ...(id ? { id } : {}),
      label: label.trim(),
      kind,
      value: savedDetailValue(kind, value),
    }));

/** The details creating a project writes. */
export const detailInputsFrom = (details: ProjectDetailDraft[]): ProjectDetailInput[] =>
  detailEditsFrom(details).map(({ label, kind, value }) => ({ label, kind, value }));

// ─── Dates ──────────────────────────────────────────────────────────────

/** A stored date as the picker starts: that day, local midnight. Today for none. */
export const dateFromDetailValue = (value: string, today: Date = new Date()): Date => {
  if (!isCalendarDate(value)) return today;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
};

const pad = (n: number): string => String(n).padStart(2, '0');

/** The day the picker chose, as stored: YYYY-MM-DD, in the device's own calendar. */
export const detailValueFromDate = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

// ─── On the project page ────────────────────────────────────────────────

/** The section on a project's page, shown when it has any details. */
export const DETAILS_TITLE = 'Details';

/**
 * A detail's value as its page shows it: a date in the device's locale
 * ("March 4, 2026"), a link without its scheme, anything else as stored.
 */
export const detailDisplayValue = (detail: Pick<ProjectDetail, 'kind' | 'value'>, locale?: string): string => {
  switch (detail.kind) {
    case 'date':
      return isCalendarDate(detail.value)
        ? dateFromDetailValue(detail.value).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' })
        : detail.value;
    case 'link':
      return detail.value.replace(/^https?:\/\//, '').replace(/\/$/, '');
    default:
      return detail.value;
  }
};
