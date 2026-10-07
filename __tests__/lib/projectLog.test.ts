//
// target: __tests__/lib/projectLog.test.ts
//
// A project's log (ONE-141), the pure logic: the rules an entry is checked
// against, what saving writes, how the page shows a day and a cost, and who
// gets which of an entry's options. Who writes to it, and how a proposal
// waits for the owner (ONE-143).

import {
  canEditLogEntry,
  emptyLogEntryDraft,
  formatLogCost,
  LOG_WRITE_LABEL,
  logEntryActions,
  logEntryDate,
  logEntryDraftChanged,
  logEntryDraftErrors,
  logEntryDraftFrom,
  logEntryDraftValid,
  logEntryEditsFrom,
  logWriteMode,
  logWriteStatus,
  newLogEntryInputFrom,
  projectLogEntryRoute,
  proposedBy,
  splitLog,
  type LogEntryDraft,
} from '../../lib/screens/projectLog';
import type { ProjectLogEntry } from '../../features/projects';

const TODAY = new Date(2026, 9, 6);

const draft = (overrides: Partial<LogEntryDraft> = {}): LogEntryDraft => ({
  ...emptyLogEntryDraft(TODAY),
  title: 'Replaced the igniter',
  ...overrides,
});

const ENTRY: ProjectLogEntry = {
  id: 'e1',
  projectId: 'pj-furnace',
  authorProfileId: 'p-owner',
  author: null,
  status: 'published',
  occurredOn: '2026-03-12',
  title: 'Replaced the igniter',
  notes: 'Under warranty',
  costCents: 18000,
  currency: 'USD',
  performedByProfileId: 'p-acme',
  performedBy: {
    id: 'p-acme',
    username: 'acme_hvac',
    name: 'Acme HVAC',
    avatarUrl: null,
    isVerified: false,
    profileType: 'business',
  },
  photos: [{ id: 'm1', url: 'https://cdn.example/receipt.jpg', sortOrder: 0 }],
  createdAt: '2026-03-12T10:00:00Z',
  updatedAt: '2026-03-12T10:00:00Z',
};

describe('an entry', () => {
  it('starts on today, with no one named and no cost', () => {
    expect(emptyLogEntryDraft(TODAY)).toMatchObject({ occurredOn: '2026-10-06', performedBy: null, cost: '', currency: 'USD' });
  });

  it('needs a title', () => {
    expect(logEntryDraftErrors(draft({ title: '  ' }), TODAY).title).toBe('Say what was done.');
    expect(logEntryDraftValid(draft(), TODAY)).toBe(true);
  });

  it("takes a day that has happened, today included, and not tomorrow", () => {
    expect(logEntryDraftErrors(draft({ occurredOn: '2026-10-06' }), TODAY).occurredOn).toBeNull();
    expect(logEntryDraftErrors(draft({ occurredOn: '2026-10-07' }), TODAY).occurredOn).toBe("That day hasn't happened yet.");
    expect(logEntryDraftErrors(draft({ occurredOn: '' }), TODAY).occurredOn).toBe('Choose the day it was done.');
  });

  it('takes a cost of at least nothing, or none', () => {
    expect(logEntryDraftErrors(draft({ cost: '' }), TODAY).cost).toBeNull();
    expect(logEntryDraftErrors(draft({ cost: '0' }), TODAY).cost).toBeNull();
    expect(logEntryDraftErrors(draft({ cost: '1,180.50' }), TODAY).cost).toBeNull();
    expect(logEntryDraftErrors(draft({ cost: '-5' }), TODAY).cost).toMatch(/Enter a cost like 180/);
    expect(logEntryDraftErrors(draft({ cost: '1.234' }), TODAY).cost).toBe('Use at most 2 decimal places.');
    expect(logEntryDraftErrors(draft({ cost: '12', currency: 'us' }), TODAY)).toMatchObject({
      currency: 'Use a three-letter currency code, like USD.',
      cost: null,
    });
  });

  it('is saved trimmed, its cost in minor units and who did it by id', () => {
    const input = newLogEntryInputFrom(
      draft({
        title: ' Replaced the igniter ',
        notes: '  ',
        cost: '180',
        currency: 'usd',
        performedBy: { id: 'p-acme', name: 'Acme HVAC', username: 'acme_hvac', avatarUrl: null },
        photos: [{ key: 'k', uri: 'file:///receipt.jpg' }],
      }),
      'pj-furnace',
      { profileId: 'p-owner', mode: 'add' },
    );
    expect(input).toEqual({
      projectId: 'pj-furnace',
      authorProfileId: 'p-owner',
      status: 'published',
      fields: {
        occurredOn: '2026-10-06',
        title: 'Replaced the igniter',
        notes: null,
        costCents: 18000,
        currency: 'USD',
        performedByProfileId: 'p-acme',
      },
      photoUris: ['file:///receipt.jpg'],
    });
  });

  it('is edited from what is stored, and saves nothing until something changes', () => {
    const start = logEntryDraftFrom(ENTRY);
    expect(start).toMatchObject({ cost: '180.00', performedBy: { id: 'p-acme', name: 'Acme HVAC' } });
    expect(logEntryDraftChanged(start, ENTRY)).toBe(false);
    expect(logEntryDraftChanged({ ...start, cost: '190' }, ENTRY)).toBe(true);
    expect(logEntryEditsFrom({ ...start, performedBy: null }).fields.performedByProfileId).toBeNull();
  });

  it("keeps a name it can't show, unless it is changed", () => {
    const hidden = logEntryDraftFrom({ ...ENTRY, performedBy: null });
    expect(logEntryEditsFrom(hidden).fields.performedByProfileId).toBe('p-acme');
  });
});

describe('on the project page', () => {
  it('reads a cost as product prices do, without cents when there are none', () => {
    expect(formatLogCost(18000, 'USD', 'en-US')).toBe('$180');
    expect(formatLogCost(18050, 'USD', 'en-US')).toBe('$180.50');
    expect(formatLogCost(1500, 'JPY', 'en-US')).toBe('¥1,500');
    expect(formatLogCost(null, 'USD', 'en-US')).toBeNull();
  });

  it('shows the day in the locale', () => {
    expect(logEntryDate('2026-03-12', 'en-US')).toBe('Mar 12, 2026');
  });

  it('gives the owner edit and delete, the named profile Remove me, and anyone else nothing', () => {
    expect(logEntryActions(ENTRY, { isOwner: true, profileId: 'p-owner' })).toEqual(['edit', 'delete']);
    expect(logEntryActions(ENTRY, { isOwner: false, profileId: 'p-acme' })).toEqual(['remove-me']);
    expect(logEntryActions(ENTRY, { isOwner: false, profileId: 'p-stranger' })).toEqual([]);
    expect(logEntryActions(ENTRY, { isOwner: false, profileId: undefined })).toEqual([]);
  });

  it('gives an author edit and delete of their own entry, and the owner Approve and Decline instead on a proposal (ONE-143)', () => {
    const byAcme = { ...ENTRY, authorProfileId: 'p-acme' };
    expect(logEntryActions(byAcme, { isOwner: false, profileId: 'p-acme' })).toEqual(['edit', 'delete', 'remove-me']);
    const proposal = { ...byAcme, status: 'proposed' as const, performedByProfileId: null };
    expect(logEntryActions(proposal, { isOwner: false, profileId: 'p-acme' })).toEqual(['edit', 'delete']);
    expect(logEntryActions(proposal, { isOwner: true, profileId: 'p-owner' })).toEqual([]);
    expect(canEditLogEntry(proposal, { isOwner: false, profileId: 'p-acme' })).toBe(true);
    expect(canEditLogEntry(proposal, { isOwner: false, profileId: 'p-stranger' })).toBe(false);
    expect(canEditLogEntry(proposal, { isOwner: true, profileId: 'p-owner' })).toBe(true);
  });

  it('opens Add to log, or one entry to edit, as a modal over the project', () => {
    expect(projectLogEntryRoute('pj-furnace')).toEqual({ pathname: '/project/pj-furnace/log', params: {} });
    expect(projectLogEntryRoute('pj-furnace', 'e1')).toEqual({ pathname: '/project/pj-furnace/log', params: { entry: 'e1' } });
  });
});

describe('who writes to the log (ONE-143)', () => {
  it('lets the owner and Contributors add, a business that scanned its tag propose, and no one else write', () => {
    expect(logWriteMode(true, undefined)).toBe('add');
    expect(logWriteMode(false, 'published')).toBe('add');
    expect(logWriteMode(false, 'proposed')).toBe('propose');
    expect(logWriteMode(false, null)).toBeNull();
    expect(LOG_WRITE_LABEL.propose).toBe('Propose a log entry');
    expect([logWriteStatus('add'), logWriteStatus('propose')]).toEqual(['published', 'proposed']);
  });

  it('writes a proposal as proposed, by the business, which did the work unless it says otherwise', () => {
    const acme = { id: 'p-acme', name: 'Acme HVAC', username: 'acme_hvac', avatarUrl: null };
    const start = emptyLogEntryDraft(TODAY, acme);
    expect(start.performedBy).toEqual(acme);
    expect(newLogEntryInputFrom({ ...start, title: 'Serviced' }, 'pj-furnace', { profileId: 'p-acme', mode: 'propose' })).toMatchObject({
      authorProfileId: 'p-acme',
      status: 'proposed',
      fields: { performedByProfileId: 'p-acme' },
    });
  });

  it('puts proposals first, each saying who it is from', () => {
    const proposal = { ...ENTRY, id: 'e2', status: 'proposed' as const, author: ENTRY.performedBy };
    expect(splitLog([ENTRY, proposal])).toEqual({ waiting: [proposal], published: [ENTRY] });
    expect(proposedBy(proposal)).toBe('Proposed by Acme HVAC');
    expect(proposedBy({ author: null })).toBe('Proposed by a business');
  });
});
