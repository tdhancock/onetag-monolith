

import React from 'react';
import { View, Text, Pressable, Image } from 'react-native';
import { useApp } from '../../store/AppContext.native';
import { useCurrentProfile } from '../../features/profiles';
import { useMyStoriesQuery } from '../../features/stories';
import type { Story } from '../../types';

interface StoryCreatorProps {
  onAddStory: () => void;
  onViewStories: (stories: Story[], startIndex: number) => void;
}

/**
 * "Your story" button — OneTag logo inside a story ring, Instagram-style.
 */
const StoryCreator: React.FC<StoryCreatorProps> = ({ onAddStory, onViewStories }) => {
  const { profile: userProfile, profileId } = useCurrentProfile();
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
    <View className="items-center mr-3">
      <Pressable
        onPress={handlePress}
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          borderWidth: 2,
          borderColor: hasAnyStory ? '#3b82f6' : '#4b5563',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#000',
          overflow: 'hidden',
        }}
        accessibilityLabel={hasAnyStory ? 'View your story' : 'Add to your story'}
      >
        <Image
          source={require('../../assets/onetag-logo.png')}
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            position: 'absolute',
          }}
          resizeMode="cover"
        />
      </Pressable>
      <Text className="text-xs text-white w-14 text-center mt-1" numberOfLines={1}>
        Your story
      </Text>
    </View>
  );
};

export default React.memo(StoryCreator);
