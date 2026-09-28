//
// target: __tests__/lib/composeTags.test.ts
//
// The composer's draft tags (ONE-46): placed, moved and removed in local
// state, capped at ten, and turned into exactly what the tags table takes
// once the post has an id.

import {
  MAX_EMBEDDED_TAGS,
  TAG_LIMIT_MESSAGE,
  TAG_REFUSED_MESSAGE,
  destinationRef,
  diffTags,
  hasTagEdits,
  isTagRefusal,
  saveTagEdits,
  seedDrafts,
  type TagWriter,
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
import type { EmbeddedTag, EmbeddedTagDestination } from '../../types';

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

// ─── Editing a published post's tags (ONE-92) ───────────────────────────

const DOOR: EmbeddedTagDestination = { kind: 'product', productId: 'pd-2', name: 'Door', imageUrl: null };
const ANA: EmbeddedTagDestination = {
  kind: 'profile', profileId: 'p-ana', username: 'ana', profileType: 'individual', name: 'Ana', imageUrl: null,
};

const SAVED: EmbeddedTag[] = [
  { id: 't-lamp', xPct: 10, yPct: 10, destination: LAMP },
  { id: 't-door', xPct: 60, yPct: 60, destination: DOOR },
];

describe('seedDrafts', () => {
  it('turns the saved tags into drafts keyed by their ids', () => {
    expect(seedDrafts(SAVED)).toEqual([
      { key: 't-lamp', xPct: 10, yPct: 10, destination: LAMP },
      { key: 't-door', xPct: 60, yPct: 60, destination: DOOR },
    ]);
  });

  it('counts toward the limit, so a photo with ten can\'t take an eleventh', () => {
    const ten = seedDrafts(
      Array.from({ length: MAX_EMBEDDED_TAGS }, (_, i) => ({ id: `t${i}`, xPct: i, yPct: i, destination: LAMP })),
    );
    expect(placeTag(ten, 50, 50)).toEqual({ ok: false, message: TAG_LIMIT_MESSAGE });
  });
});

describe('diffTags', () => {
  it('has nothing to write when nothing changed', () => {
    expect(hasTagEdits(diffTags(SAVED, seedDrafts(SAVED)))).toBe(false);
  });

  it('moves a moved tag by its id, removes a removed one, and inserts a new one', () => {
    let drafts = seedDrafts(SAVED);
    drafts = moveTag(drafts, 't-lamp', 30, 40);
    drafts = removeTag(drafts, 't-door');
    const added = placed(drafts, 80, 80);
    drafts = setTagDestination(added.drafts, added.key, ANA);

    const edits = diffTags(SAVED, drafts);
    expect(edits.move).toEqual([{ id: 't-lamp', xPct: 30, yPct: 40 }]);
    expect(edits.remove).toEqual(['t-door']);
    expect(edits.insert.map((i) => i.draft.destination)).toEqual([ANA]);
  });

  it('removes and re-inserts a tag whose destination changed: a destination is frozen once written', () => {
    const drafts = setTagDestination(seedDrafts(SAVED), 't-door', ANA);
    const edits = diffTags(SAVED, drafts);
    expect(edits.remove).toEqual(['t-door']);
    expect(edits.insert).toEqual([{ key: 't-door', draft: { key: 't-door', xPct: 60, yPct: 60, destination: ANA } }]);
    expect(edits.move).toEqual([]);
  });

  it('ignores a placed tag still waiting for its destination', () => {
    const { drafts } = placed(seedDrafts(SAVED), 5, 5);
    expect(hasTagEdits(diffTags(SAVED, drafts))).toBe(false);
  });
});

/** A writer that records what it was asked, in order, and hands out ids. */
const recordingWriter = (overrides: Partial<TagWriter> = {}) => {
  const calls: string[] = [];
  let n = 0;
  const writer: TagWriter = {
    insert: async (tags) => {
      calls.push(`insert ${tags.length}`);
      return tags.map(() => `t-new-${++n}`);
    },
    move: async (id) => {
      calls.push(`move ${id}`);
      return true;
    },
    remove: async (id) => {
      calls.push(`remove ${id}`);
    },
    ...overrides,
  };
  return { writer, calls };
};

describe('saveTagEdits', () => {
  const edited = () => {
    let drafts = moveTag(seedDrafts(SAVED), 't-lamp', 30, 40);
    drafts = removeTag(drafts, 't-door');
    const added = placed(drafts, 80, 80);
    return setTagDestination(added.drafts, added.key, ANA);
  };

  it('inserts, then moves, then removes: a failure never leaves fewer tags than intended', async () => {
    const { writer, calls } = recordingWriter();
    await saveTagEdits(SAVED, edited(), writer, () => undefined);
    expect(calls).toEqual(['insert 1', 'move t-lamp', 'remove t-door']);
  });

  it('ends with the saved tags matching the drafts, the moved one under its old id', async () => {
    const { writer } = recordingWriter();
    let last: { saved: EmbeddedTag[]; drafts: DraftTag[] } = { saved: [], drafts: [] };
    await saveTagEdits(SAVED, edited(), writer, (saved, drafts) => { last = { saved, drafts }; });

    expect(last.saved.map((t) => t.id).sort()).toEqual(['t-lamp', 't-new-1']);
    expect(last.saved.find((t) => t.id === 't-lamp')).toMatchObject({ xPct: 30, yPct: 40 });
    expect(hasTagEdits(diffTags(last.saved, last.drafts))).toBe(false);
  });

  it('after a failure part way, saving again doesn\'t insert twice', async () => {
    let failed = false;
    const first = recordingWriter({
      remove: async () => {
        failed = true;
        throw new Error('network');
      },
    });
    let state = { saved: SAVED, drafts: edited() };
    await expect(
      saveTagEdits(state.saved, state.drafts, first.writer, (saved, drafts) => { state = { saved, drafts }; }),
    ).rejects.toThrow('network');
    expect(failed).toBe(true);

    const second = recordingWriter();
    await saveTagEdits(state.saved, state.drafts, second.writer, () => undefined);
    expect(second.calls).toEqual(['remove t-door']);
  });

  it('treats a tag removed underneath the editor as gone, not as a failure', async () => {
    const { writer } = recordingWriter({ move: async () => false });
    let last: { saved: EmbeddedTag[]; drafts: DraftTag[] } = { saved: [], drafts: [] };
    const drafts = moveTag(seedDrafts(SAVED), 't-lamp', 30, 40);
    await saveTagEdits(SAVED, drafts, writer, (saved, d) => { last = { saved, drafts: d }; });

    expect(last.saved.map((t) => t.id)).toEqual(['t-door']);
    expect(last.drafts.map((d) => d.key)).toEqual(['t-door']);
  });

  it('writes a re-pointed tag as a new one and removes the old', async () => {
    const { writer, calls } = recordingWriter();
    await saveTagEdits(SAVED, setTagDestination(seedDrafts(SAVED), 't-door', ANA), writer, () => undefined);
    expect(calls).toEqual(['insert 1', 'remove t-door']);
  });
});

describe('refusals', () => {
  it('recognises RLS refusing a tag, and nothing else', () => {
    expect(isTagRefusal({ code: '42501', message: 'new row violates row-level security policy' })).toBe(true);
    expect(isTagRefusal(new Error('network'))).toBe(false);
    expect(isTagRefusal(null)).toBe(false);
    expect(TAG_REFUSED_MESSAGE).toMatch(/Remove it and try again/);
  });
});
