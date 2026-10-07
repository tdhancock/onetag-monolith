//
// target: __tests__/lib/notificationsGrouping.test.ts
// Notifications grouped by recency, and what each one says —
// lib/screens/notifications. Every date is fixed: "now" is Thursday
// 2026-09-24 at 15:00 local time.

import {
  followRequestsSummary,
  groupNotifications,
  notificationGroupFor,
  notificationRoute,
  notificationSentence,
} from '../../lib/screens/notifications';

const NOW = new Date(2026, 8, 24, 15, 0, 0);
const at = (day: number, hour = 12, minute = 0) => new Date(2026, 8, day, hour, minute).toISOString();

describe('notificationGroupFor', () => {
  it('puts anything since midnight in Today', () => {
    expect(notificationGroupFor(at(24, 0, 0), NOW)).toBe('today');
    expect(notificationGroupFor(at(24, 14, 59), NOW)).toBe('today');
  });

  it('puts the moment before midnight in This week', () => {
    expect(notificationGroupFor(new Date(2026, 8, 23, 23, 59, 59).toISOString(), NOW)).toBe('week');
  });

  it('keeps the six days before today in This week, and the seventh in Earlier', () => {
    expect(notificationGroupFor(at(18, 0, 0), NOW)).toBe('week');
    expect(notificationGroupFor(new Date(2026, 8, 17, 23, 59).toISOString(), NOW)).toBe('earlier');
  });

  it('puts an unreadable timestamp in Earlier', () => {
    expect(notificationGroupFor('not a date', NOW)).toBe('earlier');
  });
});

describe('groupNotifications', () => {
  const n = (id: string, created_at: string) => ({ id, created_at });

  it('makes Today, This week and Earlier sections, newest first within each', () => {
    const groups = groupNotifications(
      [n('old', at(1)), n('mon', at(21)), n('now', at(24, 14)), n('morning', at(24, 9)), n('tue', at(22))],
      NOW,
    );
    expect(groups.map(g => g.title)).toEqual(['Today', 'This week', 'Earlier']);
    expect(groups[0].data.map(x => x.id)).toEqual(['now', 'morning']);
    expect(groups[1].data.map(x => x.id)).toEqual(['tue', 'mon']);
    expect(groups[2].data.map(x => x.id)).toEqual(['old']);
  });

  it('leaves out groups with nothing in them', () => {
    expect(groupNotifications([n('a', at(24, 10))], NOW).map(g => g.key)).toEqual(['today']);
    expect(groupNotifications([], NOW)).toEqual([]);
  });
});

describe('notificationSentence', () => {
  it('says what happened, as a sentence', () => {
    expect(notificationSentence('like')).toBe('liked your post.');
    expect(notificationSentence('follow')).toBe('started following you.');
    expect(notificationSentence('comment')).toBe('commented on your post.');
  });

  it('says OneSnap, not story', () => {
    expect(notificationSentence('story_like')).toBe('liked your OneSnap.');
  });
});

describe("someone writing to a project's log (ONE-143)", () => {
  const SENDER = { id: 'p-acme', username: 'acme_hvac', avatar_url: null };
  const row = (type: 'log_entry_added' | 'log_entry_proposed', project: { id: string; name: string } | null) => ({
    type,
    sender: SENDER,
    post: null,
    comment: null,
    story: null,
    project,
  });

  it('names the project, and says whether the entry is in or waiting', () => {
    expect(notificationSentence('log_entry_added', 'Furnace')).toBe("added to Furnace's log.");
    expect(notificationSentence('log_entry_proposed', 'Furnace')).toBe("wants to add to Furnace's log.");
    expect(notificationSentence('log_entry_added')).toBe("added to your project's log.");
  });

  it('opens the project, or nothing once it is gone', () => {
    expect(notificationRoute(row('log_entry_proposed', { id: 'pj-furnace', name: 'Furnace' }))).toBe('/project/pj-furnace');
    expect(notificationRoute(row('log_entry_added', null))).toBeNull();
  });
});

describe('follow requests (ONE-63)', () => {
  it('says someone asked', () => {
    expect(notificationSentence('follow_request')).toBe('asked to follow you.');
  });

  it('counts who is waiting, in the singular and the plural', () => {
    expect(followRequestsSummary(1)).toBe('1 person is waiting for your approval.');
    expect(followRequestsSummary(3)).toBe('3 people are waiting for your approval.');
  });
});
