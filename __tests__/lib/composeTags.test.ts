//
// target: __tests__/lib/composeTags.test.ts
//
// The composer's draft tags (ONE-46): placed, moved and removed in local
// state, capped at ten, and turned into exactly what the tags table takes
// once the post has an id.

import {
  MAX_EMBEDDED_TAGS,
  TAG_LIMIT_MESSAGE,
  destinationRef,
  moveTag,
  pickerOptions,
  placeTag,
  previewTags,
  removeTag,
  setTagDestination,
  tagCountLabel,
  tagsToWrite,
  type DraftTag,
} from '../../lib/screens/composeTags';
import type { EmbeddedTagDestination } from '../../types';

const LAMP: EmbeddedTagDestination = { kind: 'product', productId: 'pd-1', name: 'Lamp', imageUrl: null };

const placed = (drafts: DraftTag[], x: number, y: number) => {
  const result = placeTag(drafts, x, y);
  if (!result.ok) throw new Error(result.message);
  return result;
};

describe('placing', () => {
  it('places a tag with no destination yet, and returns its key for the picker', () => {
    const { drafts, key } = placed([], 50, 50);
    expect(drafts).toEqual([{ key, xPct: 50, yPct: 50, destination: null }]);
  });

  it('clamps a position to 0–100', () => {
    const { drafts } = placed([], -3, 140);
    expect(drafts[0]).toMatchObject({ xPct: 0, yPct: 100 });
    expect(moveTag(drafts, drafts[0].key, 101, -1)[0]).toMatchObject({ xPct: 100, yPct: 0 });
  });

  it('stops at ten, with an explanation', () => {
    let drafts: DraftTag[] = [];
    for (let i = 0; i < MAX_EMBEDDED_TAGS; i += 1) drafts = placed(drafts, i, i).drafts;
    expect(MAX_EMBEDDED_TAGS).toBe(10);
    expect(placeTag(drafts, 50, 50)).toEqual({ ok: false, message: TAG_LIMIT_MESSAGE });
  });

  it('moves and removes one tag, leaving the rest', () => {
    const a = placed([], 10, 10);
    const b = placed(a.drafts, 20, 20);
    const moved = moveTag(b.drafts, a.key, 30, 40);
    expect(moved.find((d) => d.key === a.key)).toMatchObject({ xPct: 30, yPct: 40 });
    expect(removeTag(moved, a.key).map((d) => d.key)).toEqual([b.key]);
  });
});

describe('what gets written', () => {
  it('writes only tags with a destination, as a destination ref and a position', () => {
    const a = placed([], 25.5, 40);
    const b = placed(setTagDestination(a.drafts, a.key, LAMP), 60, 60);
    expect(tagsToWrite(b.drafts)).toEqual([{ destination: { kind: 'product', id: 'pd-1' }, xPct: 25.5, yPct: 40 }]);
  });

  it('previews the same tags as viewers will see them', () => {
    const a = placed([], 25.5, 40);
    const drafts = setTagDestination(a.drafts, a.key, LAMP);
    expect(previewTags(drafts)).toEqual([{ id: a.key, xPct: 25.5, yPct: 40, destination: LAMP }]);
  });

  it('refers to each destination kind by its own id', () => {
    expect(destinationRef(LAMP)).toEqual({ kind: 'product', id: 'pd-1' });
    expect(
      destinationRef({ kind: 'profile', profileId: 'p', username: 'u', profileType: 'business', name: 'U', imageUrl: null }),
    ).toEqual({ kind: 'profile', id: 'p' });
    expect(destinationRef({ kind: 'project', projectId: 'pj', name: 'Loft', imageUrl: null })).toEqual({
      kind: 'project',
      id: 'pj',
    });
  });

  it('counts against the limit', () => {
    expect(tagCountLabel(3)).toBe('3 / 10 TAGGED');
  });
});

describe('the picker', () => {
  const options = pickerOptions(
    [{ id: 'p-1', username: 'studio', name: 'Studio', avatarUrl: null, profileType: 'business' }],
    [{ id: 'pd-1', name: 'Lamp', imageUrl: 'l.jpg', businessName: 'Other Co' }],
    [
      { id: 'pj-1', name: 'Loft', coverUrl: null, isPublic: true },
      { id: 'pj-2', name: 'Vault', coverUrl: null, isPublic: false },
    ],
  );

  it('offers profiles, products and public projects from any account', () => {
    expect(options.map((o) => o.destination.kind)).toEqual(['profile', 'product', 'project']);
    expect(options[1].subtitle).toBe('Product · Other Co');
    expect(options[0].subtitle).toBe('@studio · Business Profile');
  });

  it('never a private project, and never a post', () => {
    expect(options.map((o) => o.destination.name)).not.toContain('Vault');
    expect(options.every((o) => ['profile', 'product', 'project'].includes(o.destination.kind))).toBe(true);
  });
});
