import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { IconButton, ICON_BUTTON_SIZE, letterSpacingFor } from './ui';
import { BellIcon, SendIcon } from './Icons';
import { HOME_HEADER_BRAND, getHomeHeaderLabel } from '../../lib/screens/home';
import { color, space, type } from '../../theme/tokens';

export interface HomeHeaderProps {
  notificationCount: number;
  messageCount: number;
  /** The feed has scrolled under the header: draw the hairline. */
  scrolled: boolean;
  onPressNotifications: () => void;
  onPressMessages: () => void;
}

/** The bar's height below the safe-area top. */
export const HOME_HEADER_HEIGHT = 52;
/** The wordmark's size. Its tracking scales with it, as MonoLabel's does. */
const WORDMARK_SIZE = 18;
const ACTION_ICON_SIZE = 24;

/**
 * The Home tab's header: the OneTag wordmark on the left, Notifications and
 * Messages on the right, each with its own unread badge.
 *
 * It stays put while the feed scrolls (a sticky header), with a hairline
 * appearing under it once content has moved beneath.
 */
const HomeHeader: React.FC<HomeHeaderProps> = ({
  notificationCount,
  messageCount,
  scrolled,
  onPressNotifications,
  onPressMessages,
}) => (
  <View style={[styles.bar, scrolled && styles.barScrolled]}>
    <Text style={styles.wordmark} accessibilityRole="header">
      {HOME_HEADER_BRAND}
    </Text>
    <View style={styles.actions}>
      <IconButton
        icon={<BellIcon color={color.text} size={ACTION_ICON_SIZE} strokeWidth={1.8} />}
        accessibilityLabel={getHomeHeaderLabel('notifications', notificationCount)}
        badge={notificationCount}
        onPress={onPressNotifications}
      />
      <IconButton
        icon={<SendIcon color={color.text} size={ACTION_ICON_SIZE - 2} strokeWidth={1.8} />}
        accessibilityLabel={getHomeHeaderLabel('messages', messageCount)}
        badge={messageCount}
        onPress={onPressMessages}
      />
    </View>
  </View>
);

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: HOME_HEADER_HEIGHT,
    paddingLeft: space.lg,
    // The IconButtons inset their glyphs; this lines the last glyph up with
    // the screen's lg edge.
    paddingRight: space.lg - (ICON_BUTTON_SIZE - ACTION_ICON_SIZE) / 2,
    backgroundColor: color.bg,
    // Always 1pt, so the hairline appearing does not shift the layout.
    borderBottomWidth: 1,
    borderBottomColor: color.bg,
  },
  barScrolled: {
    borderBottomColor: color.border,
  },
  wordmark: {
    fontFamily: type.mono,
    fontSize: WORDMARK_SIZE,
    letterSpacing: letterSpacingFor(WORDMARK_SIZE),
    color: color.text,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});

export default HomeHeader;
