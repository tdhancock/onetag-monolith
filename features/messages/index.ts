// The public surface of the direct messages domain.
//
// Screens and other features import from `features/messages`, never from a
// file inside it. See features/README.md.

export {
  getChatListUsers,
  fetchThread,
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
} from './mutations';

export { useMessagesRealtime } from './realtime';
export { isPendingMessage } from './cache';

export type { Conversation, Message, SendMessageInput } from './types';
