import React from 'react';
import { useCurrentProfile } from '../../features/profiles';
import { useMyStoriesQuery } from '../../features/stories';
import { latestOneSnap } from '../../lib/oneSnaps';
import { OneSnapCard } from './StoryReel';
import type { Story } from '../../types';

interface StoryCreatorProps {
  onAddStory: () => void;
  onViewStories: (stories: Story[], startIndex: number) => void;
}

/**
 * The "Your OneSnap" tile at the start of the reel: an empty card with a `+`
 * when you have nothing live, or your latest OneSnap with a small `+` badge
 * when you do. Tapping views what you have, or creates one if you have none.
 */
const StoryCreator: React.FC<StoryCreatorProps> = ({ onAddStory, onViewStories }) => {
  const { profileId } = useCurrentProfile();
  // "Your story" is a query now (ONE-19); an upload in flight shows here as
  // its optimistic local entry until the server copy replaces it.
  const { data: myStories = [] } = useMyStoriesQuery(profileId);
  const hasAnyStory = myStories.length > 0;

  const handlePress = () => {
    if (hasAnyStory) {
      onViewStories(myStories, 0);
    } else {
      onAddStory();
    }
  };

  return (
    <OneSnapCard
      story={hasAnyStory ? latestOneSnap(myStories) : undefined}
      own
      label="Your OneSnap"
      addBadge={hasAnyStory}
      onPress={handlePress}
      accessibilityLabel={hasAnyStory ? 'View your OneSnap' : 'Add a OneSnap'}
    />
  );
};

export default React.memo(StoryCreator);
