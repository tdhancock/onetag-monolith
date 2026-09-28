// The public surface of the direct messages domain.
//
// Screens and other features import from `features/messages`, never from a
// file inside it. See features/README.md.

export {
  getChatListUsers,
  fetchThread,
  fetchOlderMessages,
  THREAD_PAGE_SIZE,
  fetchMessageById,
  fetchUnreadSenderIds,
  sendMessage,
  markMessagesAsRead,
  markAllMessagesAsRead,
  deleteChatHistory,
  deleteConversationForBothSides,
} from './api';

export { messageKeys } from './keys';

export {
  useConversationsQuery,
  useThreadQuery,
  useUnreadMessageCount,
  useUnreadChats,
} from './queries';

export {
  useSendMessage,
  useMarkChatRead,
  useMarkAllMessagesRead,
  useDeleteConversation,
  useOlderMessages,
} from './mutations';

export { useMessagesRealtime } from './realtime';
export { isPendingMessage } from './cache';

export type { Conversation, Message, SendMessageInput } from './types';
