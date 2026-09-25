// Compact relative time — "just now", "5min", "2h", "3d", "1w", "4m", "1y" —
// as the post card and the OneSnap viewer print it beside a name.

import {
  differenceInMinutes,
  differenceInHours,
  differenceInDays,
  differenceInWeeks,
  differenceInMonths,
  differenceInYears,
} from 'date-fns';

export const getTimeAgo = (timestamp?: string | Date | null): string => {
  if (!timestamp) return '';
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMin = differenceInMinutes(now, date);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}min`;
    const diffH = differenceInHours(now, date);
    if (diffH < 24) return `${diffH}h`;
    const diffD = differenceInDays(now, date);
    if (diffD < 7) return `${diffD}d`;
    const diffM = differenceInMonths(now, date);
    if (diffM < 1) return `${differenceInWeeks(now, date)}w`;
    if (diffM < 12) return `${diffM}m`;
    return `${differenceInYears(now, date)}y`;
  } catch {
    return '';
  }
};
