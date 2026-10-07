import React, { useState } from 'react';
import { Keyboard, Platform, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useStore } from '@tanstack/react-form';
import { Button, IconButton, MonoLabel, Pressable, Sheet, SheetRow } from './ui';
import { DotsHorizontalIcon } from './Icons';
import { withForm } from './form';
import { projectFormOptions } from './projectFormOptions';
import type { ProjectDetailKind } from '../../features/projects';
import {
  DETAIL_KINDS,
  DETAIL_LABEL_MAX_LENGTH,
  DETAIL_VALUE_MAX_LENGTH,
  dateFromDetailValue,
  detailDisplayValue,
  detailDraftsFromTemplate,
  detailKindLabel,
  detailValueFromDate,
  newDetailDraft,
  PROJECT_DETAIL_TEMPLATES,
  PROJECT_DETAILS_MAX,
  templateSummary,
  type ProjectDetailTemplate,
} from '../../lib/screens/projectDetails';
import { color, radius, space, type } from '../../theme/tokens';

/** What the sheet holds: the kinds to add, the templates, or one detail's options. */
type Open = { kind: 'add' } | { kind: 'template' } | { kind: 'options'; index: number } | null;

/** The keyboard each typed kind gets. A date is picked, never typed. */
const KEYBOARD = { text: 'default', number: 'numeric', link: 'url' } as const;

const PLACEHOLDER: Record<Exclude<ProjectDetailKind, 'date'>, string> = {
  text: 'Value',
  number: 'e.g. 40',
  link: 'e.g. example.com/manual',
};

/**
 * A project's details in the form (ONE-140): facts the owner names, each a
 * label, a kind and a value, in the owner's order. A value is entered the way
 * its kind suits: a date from a picker, a number and a link on their own
 * keyboards. Start from a template fills in labels to complete; any left
 * without a value are not saved.
 */
const ProjectDetailsFields = withForm({
  ...projectFormOptions,
  render: function ProjectDetails({ form }) {
    const details = useStore(form.store, (state) => state.values.details);
    const [open, setOpen] = useState<Open>(null);
    const close = () => setOpen(null);

    const add = (kind: ProjectDetailKind) => {
      form.pushFieldValue('details', newDetailDraft(kind));
      close();
    };
    const startFrom = (chosen: ProjectDetailTemplate) => {
      form.setFieldValue('details', detailDraftsFromTemplate(chosen));
      close();
    };
    const move = (from: number, to: number) => {
      form.moveFieldValues('details', from, to);
      close();
    };
    const remove = (index: number) => {
      void form.removeFieldValue('details', index);
      close();
    };

    return (
      <View style={styles.section}>
        <MonoLabel color="textMid" style={styles.label}>
          Details
        </MonoLabel>
        {details.length === 0 ? (
          <Text style={styles.hint}>
            Facts to keep with it, like a model number, a filter size or when its warranty ends.
          </Text>
        ) : null}

        {details.map((detail, index) => (
          <View key={detail.key} style={styles.detail}>
            <View style={styles.detailHead}>
              <form.AppField name={`details[${index}].label`}>
                {(field) => (
                  <field.TextField
                    placeholder="Label"
                    maxLength={DETAIL_LABEL_MAX_LENGTH}
                    containerStyle={styles.detailLabel}
                    accessibilityLabel={`Detail ${index + 1} label`}
                  />
                )}
              </form.AppField>
              <MonoLabel color="textMuted">{detailKindLabel(detail.kind)}</MonoLabel>
              <IconButton
                icon={<DotsHorizontalIcon color={color.text} size={20} />}
                accessibilityLabel={`Options for detail ${index + 1}`}
                onPress={() => setOpen({ kind: 'options', index })}
              />
            </View>
            {detail.kind === 'date' ? (
              <form.Field name={`details[${index}].value`}>
                {(field) => (
                  <DetailDateValue
                    value={field.state.value}
                    onChange={field.handleChange}
                    error={field.state.meta.errors.find((e): e is string => typeof e === 'string') ?? null}
                    accessibilityLabel={`Detail ${index + 1} value`}
                  />
                )}
              </form.Field>
            ) : (
              <form.AppField name={`details[${index}].value`}>
                {(field) => (
                  <field.TextField
                    placeholder={PLACEHOLDER[detail.kind as Exclude<ProjectDetailKind, 'date'>]}
                    keyboardType={KEYBOARD[detail.kind as Exclude<ProjectDetailKind, 'date'>]}
                    autoCapitalize={detail.kind === 'link' ? 'none' : 'sentences'}
                    autoCorrect={detail.kind === 'text'}
                    maxLength={DETAIL_VALUE_MAX_LENGTH}
                    accessibilityLabel={`Detail ${index + 1} value`}
                  />
                )}
              </form.AppField>
            )}
          </View>
        ))}

        <View style={styles.actions}>
          {details.length < PROJECT_DETAILS_MAX ? (
            <Button variant="outline" size="sm" onPress={() => setOpen({ kind: 'add' })}>
              Add a detail
            </Button>
          ) : null}
          {details.length === 0 ? (
            <Button variant="outline" size="sm" onPress={() => setOpen({ kind: 'template' })}>
              Start from a template
            </Button>
          ) : null}
        </View>

        <Sheet
          visible={open !== null}
          onClose={close}
          title={open?.kind === 'add' ? 'Add a detail' : open?.kind === 'template' ? 'Start from a template' : undefined}
        >
          {open?.kind === 'add'
            ? DETAIL_KINDS.map((option) => (
                <SheetRow key={option.value} label={option.label} hint={option.hint} onPress={() => add(option.value)} />
              ))
            : null}
          {open?.kind === 'template'
            ? PROJECT_DETAIL_TEMPLATES.map((chosen) => (
                <SheetRow
                  key={chosen.name}
                  label={chosen.name}
                  hint={templateSummary(chosen)}
                  onPress={() => startFrom(chosen)}
                />
              ))
            : null}
          {open?.kind === 'options' ? (
            <>
              {open.index > 0 ? <SheetRow label="Move up" onPress={() => move(open.index, open.index - 1)} /> : null}
              {open.index < details.length - 1 ? (
                <SheetRow label="Move down" onPress={() => move(open.index, open.index + 1)} />
              ) : null}
              <SheetRow label="Remove detail" destructive onPress={() => remove(open.index)} />
            </>
          ) : null}
        </Sheet>
      </View>
    );
  },
});

/**
 * A date detail's value: drawn as a field, it opens the system picker.
 * Android's picker is a dialog that closes itself; iOS's spins in place
 * until Done, which keeps today if nothing was turned.
 */
function DetailDateValue({
  value,
  onChange,
  error,
  accessibilityLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  accessibilityLabel: string;
}) {
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
      <Pressable
        onPress={() => {
          Keyboard.dismiss();
          setPicking(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${accessibilityLabel}, ${shown ?? 'no date yet'}`}
        style={({ pressed }) => [styles.dateField, pressed && styles.dateFieldPressed]}
      >
        <Text style={shown ? styles.dateValue : styles.datePlaceholder}>{shown ?? 'Choose a date'}</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {picking ? (
        <View style={styles.picker}>
          <DateTimePicker
            value={dateFromDetailValue(value)}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={onPick}
          />
          {Platform.OS === 'ios' ? (
            <Button variant="outline" size="sm" onPress={done} style={styles.pickerDone}>
              Done
            </Button>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  label: {
    marginBottom: space.sm,
  },
  hint: {
    fontFamily: type.body,
    fontSize: 13,
    lineHeight: 18,
    color: color.textMid,
  },
  detail: {
    gap: space.sm,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border,
  },
  detailHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  detailLabel: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.md,
  },
  // Drawn as a TextField, since it reads as one.
  dateField: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.none,
    backgroundColor: color.bgPanel,
  },
  dateFieldPressed: {
    borderColor: color.text,
  },
  dateValue: {
    fontFamily: type.body,
    fontSize: 15,
    color: color.text,
  },
  datePlaceholder: {
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
  pickerDone: {
    alignSelf: 'center',
  },
});

export default ProjectDetailsFields;
