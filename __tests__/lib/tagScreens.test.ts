//
// target: __tests__/lib/tagScreens.test.ts
//
// The decisions behind the tag screens (lib/screens/tags.ts), without
// mounting anything:
//
//   1. The create flow (ONE-32): the steps and what each needs, the picker
//      offering only the account's own profiles, a replacement's pre-fill,
//      and the insert a finished draft makes.
//   2. The dashboard (ONE-34): filters (Embedded included), labels, and what
//      deleting a tag is said to mean before anything is removed.

import type { OwnedTag } from '../../features/tags';
import { asProfileId } from '../../types';
import {
  canContinue,
  chosenDestination,
  deleteTagConfirm,
  destinationLabel,
  destinationSections,
  EMPTY_TAG_DRAFT,
  filterTags,
  initialTagCreate,
  newTagFromDraft,
  nextStep,
  previousStep,
  replacementRoute,
  scanSummary,
  stepProgressLabel,
  TAG_CREATE_STEPS,
  TAG_NAME_MAX_LENGTH,
  TAG_STATE_FILTERS,
  TAG_TYPE_FILTERS,
  tagCreateRoute,
  tagDetailRoute,
  tagExportRoute,
  tagTitle,
  type TagDraft,
} from '../../lib/screens/tags';

const ANA = { id: 'p-ana', name: 'Ana Reyes', username: 'ana', profileType: 'individual' as const, profilePicture: null };
const STUDIO = { id: 'p-studio', name: 'Ana Studio', username: 'ana_studio', profileType: 'business' as const };
const SECTIONS = destinationSections([ANA, STUDIO]);

const tag = (overrides: Partial<OwnedTag> = {}): OwnedTag => ({
  id: 't1',
  ownerProfileId: 'p-studio',
  tagType: 'physical',
  format: 'qr',
  name: 'Front door',
  note: null,
  shortCode: 'ABC23XYZ',
  active: true,
  createdAt: '2026-09-20T10:00:00Z',
  destination: { kind: 'profile', profileId: 'p-studio', username: 'ana_studio', name: 'Ana Studio', profileType: 'business' },
  scanCount: 0,
  lastScannedAt: null,
  ...overrides,
});

// ─── 1. The create flow ─────────────────────────────────────────────────

describe('the create flow', () => {
  it('runs type → destination → details → confirm, and says where it is', () => {
    expect(TAG_CREATE_STEPS).toEqual(['type', 'destination', 'details', 'confirm']);
    expect(nextStep('type')).toBe('destination');
    expect(nextStep('confirm')).toBeNull();
    expect(previousStep('details')).toBe('destination');
    expect(previousStep('type')).toBeNull();
    expect(stepProgressLabel('details')).toBe('Step 3 of 4');
  });

  it("offers the account's own profiles as destinations, and nothing else", () => {
    expect(SECTIONS).toHaveLength(1);
    expect(SECTIONS[0]!.kind).toBe('profile');
    expect(SECTIONS[0]!.options.map((option) => option.destination)).toEqual([
      { kind: 'profile', id: 'p-ana' },
      { kind: 'profile', id: 'p-studio' },
    ]);
    expect(SECTIONS[0]!.options[1]!.subtitle).toBe('@ana_studio · Business');
    // Nothing to pick from, no empty section.
    expect(destinationSections([])).toEqual([]);
  });

  it('needs an answer before each step moves on', () => {
    expect(canContinue('type', EMPTY_TAG_DRAFT, SECTIONS)).toBe(false);
    expect(canContinue('type', { ...EMPTY_TAG_DRAFT, tagType: 'digital' }, SECTIONS)).toBe(true);

    expect(canContinue('destination', EMPTY_TAG_DRAFT, SECTIONS)).toBe(false);
    const own: TagDraft = { ...EMPTY_TAG_DRAFT, destination: { kind: 'profile', id: 'p-ana' } };
    expect(canContinue('destination', own, SECTIONS)).toBe(true);

    // Someone else's profile is not a choice, even if a draft somehow holds it.
    const theirs: TagDraft = { ...EMPTY_TAG_DRAFT, destination: { kind: 'profile', id: 'p-someone' } };
    expect(canContinue('destination', theirs, SECTIONS)).toBe(false);

    // Name and note are optional, within their limits.
    expect(canContinue('details', EMPTY_TAG_DRAFT, SECTIONS)).toBe(true);
    expect(canContinue('details', { ...EMPTY_TAG_DRAFT, name: 'x'.repeat(TAG_NAME_MAX_LENGTH + 1) }, SECTIONS)).toBe(false);

    expect(canContinue('confirm', { ...own, tagType: 'physical' }, SECTIONS)).toBe(true);
    expect(canContinue('confirm', own, SECTIONS)).toBe(false);
  });

  it('starts a fresh flow at the type step', () => {
    expect(initialTagCreate({}, SECTIONS)).toEqual({ draft: EMPTY_TAG_DRAFT, step: 'type' });
  });

  it('starts a replacement at naming it, with its type and destination chosen', () => {
    expect(initialTagCreate({ type: 'physical', destination: 'p-studio' }, SECTIONS)).toEqual({
      draft: { ...EMPTY_TAG_DRAFT, tagType: 'physical', destination: { kind: 'profile', id: 'p-studio' } },
      step: 'details',
    });
  });

  it('ignores a pre-filled destination the account does not own, and a type it cannot create', () => {
    expect(initialTagCreate({ type: 'physical', destination: 'p-someone' }, SECTIONS)).toEqual({
      draft: { ...EMPTY_TAG_DRAFT, tagType: 'physical' },
      step: 'destination',
    });
    // Embedded Tags are made in the post composer (M6), never here.
    expect(initialTagCreate({ type: 'embedded', destination: 'p-ana' }, SECTIONS).draft.tagType).toBeNull();
  });

  it('turns a finished draft into the insert, attributed to the active profile, with no short code', () => {
    const draft: TagDraft = {
      tagType: 'physical',
      destination: { kind: 'profile', id: 'p-ana' },
      name: '  Front door ',
      note: '   ',
    };
    const insert = newTagFromDraft(draft, asProfileId('p-studio'));
    expect(insert).toEqual({
      ownerProfileId: 'p-studio',
      tagType: 'physical',
      destinationProfileId: 'p-ana',
      name: 'Front door',
      note: null,
    });
    expect(insert).not.toHaveProperty('shortCode');
    expect(newTagFromDraft(EMPTY_TAG_DRAFT, asProfileId('p-studio'))).toBeNull();
  });

  it('finds the option a draft chose, for the confirm step', () => {
    expect(chosenDestination(SECTIONS, { kind: 'profile', id: 'p-studio' })?.title).toBe('Ana Studio');
    expect(chosenDestination(SECTIONS, null)).toBeNull();
  });
});

// ─── 2. The dashboard ───────────────────────────────────────────────────

describe('the dashboard', () => {
  const tags = [
    tag({ id: 'old', createdAt: '2026-09-01T00:00:00Z' }),
    tag({ id: 'new-digital', tagType: 'digital', format: null, createdAt: '2026-09-24T00:00:00Z' }),
    tag({ id: 'paused', active: false, createdAt: '2026-09-10T00:00:00Z' }),
  ];

  it('filters by every type, Embedded included, and by state', () => {
    expect(TAG_TYPE_FILTERS.map((f) => f.value)).toEqual(['all', 'physical', 'digital', 'embedded']);
    expect(TAG_STATE_FILTERS.map((f) => f.value)).toEqual(['all', 'active', 'inactive']);

    expect(filterTags(tags, 'all', 'all').map((t) => t.id)).toEqual(['new-digital', 'paused', 'old']);
    expect(filterTags(tags, 'physical', 'all').map((t) => t.id)).toEqual(['paused', 'old']);
    expect(filterTags(tags, 'all', 'inactive').map((t) => t.id)).toEqual(['paused']);
    expect(filterTags(tags, 'physical', 'active').map((t) => t.id)).toEqual(['old']);
    expect(filterTags(tags, 'embedded', 'all')).toEqual([]);
  });

  it('names a tag by its name, or by its destination when it has none', () => {
    expect(tagTitle(tag())).toBe('Front door');
    expect(tagTitle(tag({ name: '  ' }))).toBe('Ana Studio');
    expect(tagTitle(tag({ name: null, destination: null }))).toBe('Untitled tag');
    expect(destinationLabel(tag().destination)).toBe('Ana Studio · @ana_studio');
    expect(destinationLabel(null)).toBe('Destination removed');
  });

  it('says how often a tag has been scanned, and never by whom', () => {
    expect(scanSummary(tag())).toBe('No scans yet');
    expect(scanSummary(tag({ scanCount: 1, lastScannedAt: null }))).toBe('1 scan');
    const recent = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(scanSummary(tag({ scanCount: 12, lastScannedAt: recent }))).toBe('12 scans · last 2h');
  });

  it('says, before deleting, that the tag stops working for everyone, permanently', () => {
    const physical = deleteTagConfirm(tag());
    expect(physical.body).toContain('Anything printed with ABC23XYZ will stop working for everyone, permanently.');
    expect(physical.body).toContain('make it inactive instead');
    expect(deleteTagConfirm(tag({ tagType: 'digital' })).body).toContain('will stop working for everyone, permanently');
    expect(physical.confirm).toBe('Delete permanently');
  });
});

describe('routes to the tag screens', () => {
  it('builds each screen route, and no tag URL', () => {
    expect(tagDetailRoute('t1')).toBe('/tags/t1');
    expect(tagExportRoute('t1')).toBe('/tags/t1/export');
    expect(tagCreateRoute()).toEqual({ pathname: '/tags/create', params: {} });
  });

  it('opens a replacement with the same type and destination', () => {
    expect(replacementRoute(tag())).toEqual({
      pathname: '/tags/create',
      params: { type: 'physical', destination: 'p-studio' },
    });
  });
});
