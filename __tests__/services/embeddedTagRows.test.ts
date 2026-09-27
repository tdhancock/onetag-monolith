//
// target: __tests__/services/embeddedTagRows.test.ts
//
// Embedded Tags read with their post (ONE-45): in POST_SELECT_QUERY, so a
// feed page is one request, and mapped onto `Post.embeddedTags`.

import { POST_SELECT_QUERY, mapEmbeddedTags, mapPostData } from '../../services/postRows';

const tagRow = (overrides: Record<string, unknown> = {}) => ({
  id: 't-1',
  active: true,
  tag_x_pct: '25.50',
  tag_y_pct: 40,
  dest_profile_id: null,
  dest_product_id: 'pd-1',
  dest_project_id: null,
  dest_profile: null,
  dest_product: {
    id: 'pd-1',
    name: 'Lamp',
    product_media: [
      { url: 'https://x.test/second.jpg', media_type: 'photo', sort_order: 1 },
      { url: 'https://x.test/clip.mp4', media_type: 'video', sort_order: 0 },
      { url: 'https://x.test/first.jpg', media_type: 'photo', sort_order: 0 },
    ],
  },
  dest_project: null,
  ...overrides,
});

describe('POST_SELECT_QUERY', () => {
  it('embeds a post\'s tags in the post\'s own request, through its host post key', () => {
    expect(POST_SELECT_QUERY).toMatch(/embedded_tags:tags!host_post_id\(/);
    for (const column of ['tag_x_pct', 'tag_y_pct', 'active']) expect(POST_SELECT_QUERY).toContain(column);
  });

  it('never reads a tag\'s note — it is the owner\'s alone (ONE-82)', () => {
    const embed = POST_SELECT_QUERY.split('embedded_tags:')[1];
    expect(embed).not.toMatch(/\bnote\b/);
  });
});

describe('mapEmbeddedTags', () => {
  it('maps a product tag, with its first photo by sort order', () => {
    expect(mapEmbeddedTags([tagRow()])).toEqual([
      {
        id: 't-1',
        xPct: 25.5,
        yPct: 40,
        destination: { kind: 'product', productId: 'pd-1', name: 'Lamp', imageUrl: 'https://x.test/first.jpg' },
      },
    ]);
  });

  it('maps profile and project destinations', () => {
    const [profile, project] = mapEmbeddedTags([
      tagRow({
        id: 't-2',
        dest_product_id: null,
        dest_product: null,
        dest_profile_id: 'p-1',
        dest_profile: { id: 'p-1', username: 'studio', full_name: 'Studio', avatar_url: 'a.jpg', profile_type: 'business' },
      }),
      tagRow({
        id: 't-3',
        dest_product_id: null,
        dest_product: null,
        dest_project_id: 'pj-1',
        dest_project: { id: 'pj-1', name: 'Loft', cover_url: null },
      }),
    ]);
    expect(profile.destination).toEqual({
      kind: 'profile',
      profileId: 'p-1',
      username: 'studio',
      profileType: 'business',
      name: 'Studio',
      imageUrl: 'a.jpg',
    });
    expect(project.destination).toEqual({ kind: 'project', projectId: 'pj-1', name: 'Loft', imageUrl: null });
  });

  it('leaves off a paused tag and one whose destination the viewer cannot see', () => {
    expect(
      mapEmbeddedTags([
        tagRow({ active: false }),
        tagRow({ id: 't-hidden', dest_product_id: null, dest_product: null, dest_project_id: 'pj-x', dest_project: null }),
      ]),
    ).toEqual([]);
  });

  it('is empty for a post with none', () => {
    expect(mapEmbeddedTags(undefined)).toEqual([]);
    expect(mapEmbeddedTags([])).toEqual([]);
  });

  it('is carried on the mapped post', () => {
    const post = mapPostData({ id: 'post-1', media_type: 'image', image_url: 'x.jpg', embedded_tags: [tagRow()] });
    expect(post.embeddedTags).toHaveLength(1);
  });
});
