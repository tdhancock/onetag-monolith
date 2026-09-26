import React from 'react';
import { IconButton } from './ui';
import { ArrowLeftIcon } from './Icons';
import type { BackOrHome } from '../../lib/useBackOrHome';
import { color } from '../../theme/tokens';

/**
 * The header's Back for a screen that is alone on the stack (ONE-90): opened
 * from a cold-start tag link, where the native header would show none. It goes
 * home, so the screen is never a dead end.
 */
const HomeBackButton: React.FC<{ onPress: () => void }> = ({ onPress }) => (
  <IconButton icon={<ArrowLeftIcon color={color.text} size={22} />} accessibilityLabel="Back" onPress={onPress} />
);

/**
 * A Stack.Screen `headerLeft` for a Destination: nothing when the native Back
 * already shows, and a Back that goes home when the stack has nothing to pop.
 */
export const homeBackHeaderLeft = (back: BackOrHome) =>
  back.canGoBack ? undefined : () => <HomeBackButton onPress={back.goBack} />;

export default HomeBackButton;
