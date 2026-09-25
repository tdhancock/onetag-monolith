import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { usernameAvailabilityLabel, type UsernameAvailability } from '../../lib/screens/auth';
import { color, space, type } from '../../theme/tokens';

/**
 * The status inside a username field: a spinner while the handle is looked
 * up, then Available or Taken. Shared by sign up and adding a profile
 * (ONE-26), so both say it the same way.
 */
const UsernameStatus: React.FC<{ status: UsernameAvailability }> = ({ status }) => {
  if (status === 'checking') {
    return (
      <View style={styles.status}>
        <ActivityIndicator size="small" color={color.textMuted} accessibilityLabel="Checking username" />
      </View>
    );
  }
  const label = usernameAvailabilityLabel(status);
  if (!label) return null;
  return (
    <View style={styles.status} accessibilityLiveRegion="polite">
      <Text style={[styles.statusLabel, status === 'taken' && styles.statusTaken]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  status: {
    minHeight: 44,
    justifyContent: 'center',
    paddingRight: space.sm,
  },
  statusLabel: {
    fontFamily: type.bodyMedium,
    fontSize: 13,
    color: color.textMid,
  },
  statusTaken: {
    color: color.heart,
  },
});

export default UsernameStatus;
