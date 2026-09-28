// The public surface of the direct messages domain.
//
// Screens and other features import from `features/messages`, never from a
// file inside it. See features/README.md.

export {
  CHAT_LIST_SELECT,
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

export type { Conversation, ConversationPreview, Message, SendMessageInput } from './types';
