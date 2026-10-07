import React, { useState } from 'react';
import { Keyboard, Platform, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Button, MonoLabel, Pressable } from './ui';
import { dateFromDetailValue, detailDisplayValue, detailValueFromDate } from '../../lib/screens/projectDetails';
import { color, radius, space, type } from '../../theme/tokens';

export interface DateFieldProps {
  /** YYYY-MM-DD, or empty for none yet. */
  value: string;
  onChange: (value: string) => void;
  /** A MonoLabel shown above the field. */
  label?: string;
  error?: string | null;
  /** Read with the date shown: "Installed, March 4, 2026". */
  accessibilityLabel: string;
  placeholder?: string;
  /** The latest day the picker offers: today, for something already done. */
  maximumDate?: Date;
}

/**
 * A day, drawn as a field, chosen from the system picker: a project detail's
 * date (ONE-140), the day a log entry's work was done (ONE-141). Android's
 * picker is a dialog that closes itself; iOS's spins in place until Done,
 * which keeps today if nothing was turned.
 */
const DateField: React.FC<DateFieldProps> = ({
  value,
  onChange,
  label,
  error,
  accessibilityLabel,
  placeholder = 'Choose a date',
  maximumDate,
}) => {
  const [picking, setPicking] = useState(false);
  const shown = value ? detailDisplayValue({ kind: 'date', value }) : null;

  const onPick = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android' || event.type === 'dismissed') setPicking(false);
    if (event.type === 'set' && date) onChange(detailValueFromDate(date));
  };
  const done = () => {
    if (!value) onChange(detailValueFromDate(new Date()));
    setPicking(false);
  };

  return (
    <View>
      {label ? (
        <MonoLabel color="textMid" style={styles.label}>
          {label}
        </MonoLabel>
      ) : null}
      <Pressable
        onPress={() => {
          Keyboard.dismiss();
          setPicking(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${accessibilityLabel}, ${shown ?? 'no date yet'}`}
        style={({ pressed }) => [styles.field, pressed && styles.fieldPressed]}
      >
        <Text style={shown ? styles.value : styles.placeholder}>{shown ?? placeholder}</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {picking ? (
        <View style={styles.picker}>
          <DateTimePicker
            value={dateFromDetailValue(value)}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            maximumDate={maximumDate}
            onChange={onPick}
          />
          {Platform.OS === 'ios' ? (
            <Button variant="outline" size="sm" onPress={done} style={styles.done}>
              Done
            </Button>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  label: {
    marginBottom: space.xs,
  },
  // Drawn as a TextField, since it reads as one.
  field: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.none,
    backgroundColor: color.bgPanel,
  },
  fieldPressed: {
    borderColor: color.text,
  },
  value: {
    fontFamily: type.body,
    fontSize: 15,
    color: color.text,
  },
  placeholder: {
    fontFamily: type.body,
    fontSize: 15,
    color: color.textMuted,
  },
  error: {
    marginTop: space.xs,
    fontFamily: type.body,
    fontSize: 13,
    color: color.heart,
  },
  picker: {
    marginTop: space.sm,
    borderWidth: 1,
    borderColor: color.border,
    paddingBottom: space.md,
    alignItems: 'stretch',
  },
  done: {
    alignSelf: 'center',
  },
});

export default DateField;
