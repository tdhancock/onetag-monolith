//
// target: __tests__/api/post_tags.test.ts
//
// Editing a published post's Embedded Tags (ONE-92) against the local stack,
// through the writer Edit Post uses and the post read every screen uses.

import { actAs, supabase } from './support/liveSupabase';
import { sql } from './support/localStack';
import { createAccount, deleteAccounts, type Account } from './support/accounts';
import { embeddedTagWriter } from '../../features/tags/mutations';
import { deleteTag, moveEmbeddedTag, TagNotFoundError } from '../../features/tags/api';
import { fetchPostById } from '../../features/posts/api';

let author: Account;
let tagged: Account;
let stranger: Account;
let postId: string;
let kept: string;
let removed: string;

beforeAll(async () => {
  [author, tagged, stranger] = await Promise.all(['tagauthor', 'tagged', 'tagstrange'].map(createAccount));
  postId = sql(`
    INSERT INTO public.posts (user_id, content, image_url, media_type)
    VALUES ('${author.profileId}', 'a photo', 'https://example.test/photo.jpg', 'image') RETURNING id;
  `);
});

afterAll(() => deleteAccounts());

describe("editing a published post's tags", () => {
  it('adds, moves and removes them, and the post reads back as edited', async () => {
    actAs(author.client);
    const writer = embeddedTagWriter(postId, author.profileId);
    [kept, removed] = await writer.insert([
      { destination: { kind: 'profile', id: tagged.profileId }, xPct: 10, yPct: 20 },
      { destination: { kind: 'profile', id: author.profileId }, xPct: 50, yPct: 50 },
    ]);

    expect(await writer.move(kept, 30, 40)).toBe(true);
    await writer.remove(removed);
    await writer.remove(removed);

    const post = await fetchPostById(postId, author.profileId);
    expect(post?.embeddedTags?.map((tag) => ({ id: tag.id, x: tag.xPct, y: tag.yPct }))).toEqual([
      { id: kept, x: 30, y: 40 },
    ]);
  });

  it("keeps a tag's destination: only its position can change", async () => {
    actAs(author.client);
    const { error } = await supabase.from('tags').update({ dest_profile_id: stranger.profileId }).eq('id', kept);
    expect(error).toBeTruthy();
  });

  it("won't let a stranger move or remove someone else's tag", async () => {
    actAs(stranger.client);
    expect(await moveEmbeddedTag(kept, 1, 1)).toBe(false);
    await expect(deleteTag(kept)).rejects.toBeInstanceOf(TagNotFoundError);
  });

  it("lets the tagged profile's owner take the tag off (ONE-44)", async () => {
    actAs(tagged.client);
    await deleteTag(kept);

    actAs(author.client);
    expect((await fetchPostById(postId, author.profileId))?.embeddedTags ?? []).toEqual([]);
  });
});
