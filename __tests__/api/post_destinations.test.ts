//
// target: __tests__/api/post_destinations.test.ts
//
// A Tag can point to a post (2026-09-28), against the local stack, through
// the app's own data layer: a Digital Tag for your post resolves to it for a
// stranger, reads back on your Tags dashboard, and a photo's tag pointing at
// the post reads with the photo.

import { actAs } from './support/liveSupabase';
import { anonClient, sql } from './support/localStack';
import { createAccount, deleteAccounts, type Account } from './support/accounts';
import { createEmbeddedTags, createTag, fetchMyTags, resolveTag } from '../../features/tags/api';
import { fetchPostById } from '../../features/posts/api';

let author: Account;
let fan: Account;
let postId: string;
let photoId: string;

beforeAll(async () => {
  [author, fan] = await Promise.all(['pdauthor', 'pdfan'].map(createAccount));
  postId = sql(`
    INSERT INTO public.posts (user_id, content, image_url, media_type)
    VALUES ('${author.profileId}', 'The new kitchen', 'https://example.test/k.jpg', 'image') RETURNING id;
  `);
  photoId = sql(`
    INSERT INTO public.posts (user_id, content, image_url, media_type)
    VALUES ('${fan.profileId}', 'look at this', 'https://example.test/f.jpg', 'image') RETURNING id;
  `);
});

afterAll(() => deleteAccounts());

describe('tags pointing at posts', () => {
  let shortCode: string;

  it('makes a Digital Tag for your own post, and lists it by the post', async () => {
    actAs(author.client);
    const tag = await createTag({
      ownerProfileId: author.profileId,
      tagType: 'digital',
      destination: { kind: 'post', id: postId },
      name: null,
      note: null,
    });
    shortCode = tag.shortCode;
    expect(tag.destination).toEqual({ kind: 'post', postId, username: author.username, name: 'The new kitchen' });

    const mine = await fetchMyTags(author.profileId);
    expect(mine.find((t) => t.id === tag.id)?.destination?.kind).toBe('post');
  });

  it("refuses a tag for someone else's post", async () => {
    actAs(fan.client);
    await expect(
      createTag({ ownerProfileId: fan.profileId, tagType: 'digital', destination: { kind: 'post', id: postId }, name: null, note: null }),
    ).rejects.toBeTruthy();
  });

  it('resolves to the post for a stranger with no account', async () => {
    actAs(anonClient());
    const resolution = await resolveTag(shortCode);
    expect(resolution).toEqual({ status: 'active', tagId: expect.any(String), destination: { kind: 'post', postId } });
  });

  it("lets a photo carry a tag pointing at someone else's post, read with the photo", async () => {
    actAs(fan.client);
    await createEmbeddedTags(photoId, fan.profileId, [{ destination: { kind: 'post', id: postId }, xPct: 40, yPct: 60 }]);
    const photo = await fetchPostById(photoId, fan.profileId);
    expect(photo?.embeddedTags?.map((t) => t.destination)).toEqual([
      { kind: 'post', postId, username: author.username, name: 'The new kitchen', imageUrl: 'https://example.test/k.jpg' },
    ]);
  });
});
