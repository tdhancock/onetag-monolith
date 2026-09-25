import React from "react";
import { Avatar, DEFAULT_AVATAR_SIZE } from "./ui";

interface UserAvatarProps {
  username: string | null | undefined;
  avatarUrl: string | null | undefined;
  size?: number;
  /** Accepted for the call sites that still pass one; the avatar ignores it. */
  className?: string;
}

/**
 * The props older screens call the avatar with, mapped onto the `Avatar`
 * primitive. There is one avatar implementation, and this is not it — it is
 * an adapter so ~20 call sites keep working until their own re-skin tickets
 * move them to `Avatar` directly (ONE-64).
 */
const UserAvatar: React.FC<UserAvatarProps> = ({ username, avatarUrl, size = DEFAULT_AVATAR_SIZE }) => (
  <Avatar uri={avatarUrl} name={username} size={size} />
);

export default UserAvatar;
