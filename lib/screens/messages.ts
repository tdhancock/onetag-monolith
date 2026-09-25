//
// Pure logic extracted from app/messages.tsx so the thread's layout rules —
// how far apart two bubbles sit, which bubble carries the time, and what its
// status line says — can be tested without mounting the screen.

import { space } from '../../theme/tokens';

/** The fields these rules read off a message. */
export interface ThreadMessage {
  id: string;
  sender_id: string;
  created_at: string;
}

/** Placeholder the status line shows while a send is in flight. */
export const MESSAGE_SENDING_LABEL = 'Sending…' as const;
/** What the status line says once the server has the message. */
export const MESSAGE_SENT_LABEL = 'Sent' as const;

/**
 * The gap above the bubble at `index`: none for the first, `xs` when the
 * same person sent the one before, `md` when the sender changes. Consecutive
 * messages read as one run; a change of speaker reads as a new turn.
 */
export const bubbleGapAbove = (messages: readonly ThreadMessage[], index: number): number => {
  if (index <= 0) return 0;
  const previous = messages[index - 1];
  const current = messages[index];
  if (!previous || !current) return 0;
  return previous.sender_id === current.sender_id ? space.xs : space.md;
};

/** Whether the bubble at `index` is the last of its sender's run. */
export const endsRun = (messages: readonly ThreadMessage[], index: number): boolean => {
  const current = messages[index];
  if (!current) return false;
  const next = messages[index + 1];
  return !next || next.sender_id !== current.sender_id;
};

/** The id of the newest message `myId` sent, or null when they have sent none. */
export const lastOwnMessageId = (
  messages: readonly ThreadMessage[],
  myId: string | null | undefined,
): string | null => {
  if (!myId) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]!.sender_id === myId) return messages[i]!.id;
  }
  return null;
};

/** A message's time as 24-hour HH:MM, the format the thread has always used. */
export const formatMessageTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
};

/**
 * The meta line under a bubble, or null for none.
 *
 * Only the last bubble of each run carries one, so a burst of messages is
 * not striped with timestamps. Your newest message also says where it is:
 * "Sending…" while it is still an optimistic copy, then "Sent" beside its
 * time once the server row replaces it. The line exists in both states, so
 * the swap never moves the bubble.
 */
export const messageMetaLabel = (options: {
  message: ThreadMessage;
  endsRun: boolean;
  isLastOwn: boolean;
  isPending: boolean;
}): string | null => {
  const { message, endsRun: lastInRun, isLastOwn, isPending } = options;
  if (isLastOwn) {
    if (isPending) return MESSAGE_SENDING_LABEL;
    const time = formatMessageTime(message.created_at);
    return time ? `${MESSAGE_SENT_LABEL} · ${time}` : MESSAGE_SENT_LABEL;
  }
  if (!lastInRun) return null;
  return formatMessageTime(message.created_at) || null;
};
