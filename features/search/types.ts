// Domain types for search (ONE-48).

export interface SearchProfile {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  isVerified: boolean;
  profileType: 'individual' | 'business';
  /** So its Follow button asks rather than follows (ONE-63). */
  isPrivate: boolean;
}

export interface SearchPost {
  id: string;
  content: string;
  imageUrl: string | null;
  mediaType: 'text' | 'image';
  authorUsername: string;
  authorAvatarUrl: string | null;
}

export interface SearchProduct {
  id: string;
  name: string;
  category: string | null;
  imageUrl: string | null;
  businessUsername: string;
  businessName: string;
}

export interface SearchProject {
  id: string;
  name: string;
  /** A project's category is its project type. */
  category: string | null;
  coverUrl: string | null;
  ownerUsername: string;
}
