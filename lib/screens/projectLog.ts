// A project's log (ONE-141), the pure logic: the Add to log route, an entry as
// the form holds it and as it is saved, its rules, and how the page shows one.
// Who may write to it, and how a proposal waits for the owner (ONE-143).
//
// A cost is a record of what the work cost, never a payment (Working
// Agreement §6). It is typed and stored as a product's price is, in minor
// units of its currency.

import type {
  LogEntryEdits,
  LogEntryStatus,
  NewLogEntryInput,
  ProjectLogEntry,
  ProjectLogEntryFields,
} from '../../features/projects';
import {
  currencyDigits,
  currencyError,
  DEFAULT_CURRENCY,
  formatPrice,
  type MediaDraft,
  normalizeCurrency,
  parsePriceInput,
  PRICE_FORMAT_ERROR,
  priceInputFrom,
} from './products';
import { dateFromDetailValue, detailValueFromDate, isCalendarDate } from './projectDetails';

export const LOG_TITLE_MAX_LENGTH = 80;
export const LOG_NOTES_MAX_LENGTH = 2000;
export const LOG_PHOTOS_MAX = 4;

// ─── Routes ─────────────────────────────────────────────────────────────

/** Add to log, or editing one entry: a modal over the project's page. */
export const projectLogEntryRoute = (projectId: string, entryId?: string) => ({
  pathname: `/project/${encodeURIComponent(projectId)}/log`,
  params: entryId ? { entry: entryId } : ({} as Record<string, string>),
});

// ─── An entry in the form ───────────────────────────────────────────────

/** Who did it, as the form shows them once chosen. */
export interface LogPerson {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
}

export interface LogEntryDraft {
  /** YYYY-MM-DD. */
  occurredOn: string;
  title: string;
  notes: string;
  /** As typed: "180", "180.50", or empty for none. */
  cost: string;
  currency: string;
  performedBy: LogPerson | null;
  /** Stored URLs and photos just picked, in order. */
  photos: MediaDraft[];
}

/**
 * A new entry: done today, by no one named yet — or, for a Contributor or a
 * business logging its own visit (ONE-143), by them.
 */
export const emptyLogEntryDraft = (today: Date = new Date(), performedBy: LogPerson | null = null): LogEntryDraft => ({
  occurredOn: detailValueFromDate(today),
  title: '',
  notes: '',
  cost: '',
  currency: DEFAULT_CURRENCY,
  performedBy,
  photos: [],
});

/** A stored entry as the edit form starts. */
export const logEntryDraftFrom = (entry: ProjectLogEntry): LogEntryDraft => ({
  occurredOn: entry.occurredOn,
  title: entry.title,
  notes: entry.notes ?? '',
  cost: priceInputFrom(entry.costCents, entry.currency),
  currency: entry.currency,
  performedBy: entry.performedBy
    ? {
        id: entry.performedBy.id,
        name: entry.performedBy.name,
        username: entry.performedBy.username,
        avatarUrl: entry.performedBy.avatarUrl,
      }
    : entry.performedByProfileId
      ? // Named, but not readable here: kept as it is, unless changed.
        { id: entry.performedByProfileId, name: "A profile you can't see", username: '', avatarUrl: null }
      : null,
  photos: entry.photos.map((photo) => ({ key: photo.id, uri: photo.url })),
});

export interface LogEntryDraftErrors {
  occurredOn: string | null;
  title: string | null;
  cost: string | null;
  currency: string | null;
}

/** A price's error, said of a cost. */
const costError = (error: string | null): string | null =>
  error === PRICE_FORMAT_ERROR ? 'Enter a cost like 180 or 180.50, or leave it empty.' : error?.replace(/price/g, 'cost') ?? null;

/**
 * What is wrong with a draft, field by field: it needs a title and a day that
 * isn't in the future, and a cost, when there is one, is an amount of at
 * least nothing. `today` is the device's.
 */
export const logEntryDraftErrors = (draft: LogEntryDraft, today: Date = new Date()): LogEntryDraftErrors => {
  const currency = currencyError(draft.currency);
  return {
    title: draft.title.trim() === '' ? 'Say what was done.' : null,
    occurredOn: !isCalendarDate(draft.occurredOn)
      ? 'Choose the day it was done.'
      : draft.occurredOn > detailValueFromDate(today)
        ? "That day hasn't happened yet."
        : null,
    currency,
    // A cost is read in its currency's units, so it waits for a valid one.
    cost: currency ? null : costError(parsePriceInput(draft.cost, normalizeCurrency(draft.currency)).error),
  };
};

export const logEntryDraftValid = (draft: LogEntryDraft, today: Date = new Date()): boolean =>
  Object.values(logEntryDraftErrors(draft, today)).every((error) => error === null);

/** A valid draft's own fields, as stored. */
export const logEntryFieldsFrom = (draft: LogEntryDraft): ProjectLogEntryFields => {
  const currency = normalizeCurrency(draft.currency);
  return {
    occurredOn: draft.occurredOn,
    title: draft.title.trim(),
    notes: draft.notes.trim() || null,
    costCents: parsePriceInput(draft.cost, currency).cents,
    currency,
    performedByProfileId: draft.performedBy?.id ?? null,
  };
};

/** What logging an entry from a draft writes, as the active profile, in the mode it writes in. */
export const newLogEntryInputFrom = (
  draft: LogEntryDraft,
  projectId: string,
  author: { profileId: string; mode: LogWriteMode },
): NewLogEntryInput => ({
  projectId,
  authorProfileId: author.profileId,
  status: logWriteStatus(author.mode),
  fields: logEntryFieldsFrom(draft),
  photoUris: draft.photos.map((photo) => photo.uri),
});

/** What saving an edit writes. */
export const logEntryEditsFrom = (draft: LogEntryDraft): LogEntryEdits => ({
  fields: logEntryFieldsFrom(draft),
  photoUris: draft.photos.map((photo) => photo.uri),
});

/** Whether an edit would save anything different from what is stored. */
export const logEntryDraftChanged = (draft: LogEntryDraft, entry: ProjectLogEntry): boolean =>
  JSON.stringify(logEntryEditsFrom(draft)) !== JSON.stringify(logEntryEditsFrom(logEntryDraftFrom(entry)));

// ─── On the project page ────────────────────────────────────────────────

/** The section on a project's page. */
export const LOG_TITLE = 'Log';

/** An empty log, which only its owner sees. */
export const LOG_EMPTY = {
  title: 'Nothing logged yet',
  body: 'Keep a dated record of the work: a service, a repair, a part replaced. Name who did it, and add what it cost and a photo of the receipt.',
} as const;

/** The day an entry's work was done, in the device's locale: "Mar 12, 2026". */
export const logEntryDate = (occurredOn: string, locale?: string): string =>
  isCalendarDate(occurredOn)
    ? dateFromDetailValue(occurredOn).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
    : occurredOn;

/**
 * A cost as an entry shows it, formatted as a product's price is, without
 * the cents when there are none: "$180", "$180.50", "¥1,500". Null for none.
 */
export const formatLogCost = (costCents: number | null, currency: string, locale?: string): string | null => {
  if (costCents === null) return null;
  const digits = currencyDigits(currency);
  if (costCents % 10 ** digits !== 0) return formatPrice(costCents, currency, locale);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(
      costCents / 10 ** digits,
    );
  } catch {
    return formatPrice(costCents, currency, locale);
  }
};

/** Whether the active profile is the one named as who did an entry's work: it may take its name off. */
export const isNamedOn = (profileId: string | undefined, entry: Pick<ProjectLogEntry, 'performedByProfileId'>): boolean =>
  Boolean(profileId && entry.performedByProfileId === profileId);

/** Whether the active profile wrote an entry (ONE-143). */
export const isAuthorOf = (profileId: string | undefined, entry: Pick<ProjectLogEntry, 'authorProfileId'>): boolean =>
  Boolean(profileId && entry.authorProfileId === profileId);

/** What an entry's ⋯ menu offers. */
export type LogEntryAction = 'edit' | 'delete' | 'remove-me';

/**
 * What the active profile may do to an entry: the owner edits and deletes a
 * published one (a proposal gets Approve and Decline instead), its author
 * edits and deletes their own (ONE-143), and the profile named as who did the
 * work takes its name off. Nothing for anyone else, who gets no menu.
 */
export const logEntryActions = (
  entry: Pick<ProjectLogEntry, 'performedByProfileId' | 'authorProfileId' | 'status'>,
  viewer: { isOwner: boolean; profileId: string | undefined },
): LogEntryAction[] => [
  ...((viewer.isOwner && entry.status === 'published') || (!viewer.isOwner && isAuthorOf(viewer.profileId, entry))
    ? (['edit', 'delete'] as const)
    : []),
  ...(isNamedOn(viewer.profileId, entry) ? (['remove-me'] as const) : []),
];

/** Whether the active profile may open an entry to edit it: its owner or its author. */
export const canEditLogEntry = (
  entry: Pick<ProjectLogEntry, 'authorProfileId'>,
  viewer: { isOwner: boolean; profileId: string | undefined },
): boolean => viewer.isOwner || isAuthorOf(viewer.profileId, entry);

// ─── Who writes to the log (ONE-143) ────────────────────────────────────

/** How the active profile writes to a log: adding to it, or proposing an entry its owner approves. */
export type LogWriteMode = 'add' | 'propose';

/**
 * How the active profile writes to a project's log, from what the database
 * says its entries would be: the owner and Contributors add, a business that
 * scanned the project's tag proposes, and anyone else doesn't write.
 */
export const logWriteMode = (isOwner: boolean, status: LogEntryStatus | null | undefined): LogWriteMode | null =>
  isOwner || status === 'published' ? 'add' : status === 'proposed' ? 'propose' : null;

/** The status an entry is written with, in a mode. */
export const logWriteStatus = (mode: LogWriteMode): LogEntryStatus => (mode === 'propose' ? 'proposed' : 'published');

/** The button, and the modal's title, for each mode. */
export const LOG_WRITE_LABEL: Record<LogWriteMode, string> = {
  add: 'Add to log',
  propose: 'Propose a log entry',
};

/** Said on the form when proposing. */
export const PROPOSAL_NOTE = "The project's owner approves it before it shows on the log.";

/** Proposals first, waiting for the owner; then the published log. Each newest first, as read. */
export const splitLog = <T extends Pick<ProjectLogEntry, 'status'>>(entries: T[]) => ({
  waiting: entries.filter((entry) => entry.status === 'proposed'),
  published: entries.filter((entry) => entry.status === 'published'),
});

/** The owner's group of proposals, at the top of the log. */
export const WAITING_FOR_YOU = 'Waiting for you';

/** What marks an author's own proposal, which only they and the owner see. */
export const WAITING_FOR_APPROVAL = 'Waiting for approval';

/** Who a proposal is from, as the owner's group says it. */
export const proposedBy = (entry: Pick<ProjectLogEntry, 'author'>): string =>
  `Proposed by ${entry.author?.name ?? 'a business'}`;

/** Said before the owner declines a proposal. */
export const declineLogEntryConfirm = (entry: Pick<ProjectLogEntry, 'title'>) => ({
  title: `Decline ${entry.title}?`,
  body: "It won't be added to the log, and it's deleted.",
  confirm: 'Decline',
});

/** Said before the owner deletes an entry. */
export const deleteLogEntryConfirm = (entry: Pick<ProjectLogEntry, 'title'>) => ({
  title: `Delete ${entry.title}?`,
  body: 'It comes off the log for good, with its photos.',
  confirm: 'Delete',
});

/** Said before the named profile takes its name off an entry. */
export const removeMeFromLogEntryConfirm = {
  title: 'Remove your name?',
  body: "You'll no longer be named as who did this work. The entry stays on the log, and only the project's owner can name you again.",
  confirm: 'Remove me',
} as const;

export const LOG_SAVE_FAILED = "Couldn't save the entry. Nothing you entered was lost; try again.";
export const LOG_PHOTO_FAILED = "A photo couldn't be uploaded, so nothing was saved. Try again.";
