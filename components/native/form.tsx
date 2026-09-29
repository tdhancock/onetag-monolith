// The app's forms run on TanStack Form. `useAppForm` is its useForm with the
// app's fields bound in: inside `<form.AppField name="bio">`, `field.TextField`
// takes its value, changes, blur and error from the field, so a screen wires
// none of that by hand. `withForm` builds part of a form that two screens
// share, as ProductForm is shared by Add and Edit.
//
// The rules stay in lib/screens as pure functions; lib/formErrors.ts hands
// them to the form and decides when a field shows its error.

import React, { forwardRef, useMemo, useState } from 'react';
import type { TextInput } from 'react-native';
import { createFormHook, createFormHookContexts, useStore } from '@tanstack/react-form';
import { TextField, type TextFieldProps } from './ui';
import PasswordField from './PasswordField';
import UsernameStatus from './UsernameStatus';
import { visibleError } from '../../lib/formErrors';
import { USERNAME_CHECK_DEBOUNCE_MS, usernameStatusFrom } from '../../lib/screens/auth';
import { HANDLE_TAKEN_MESSAGE, usernameError } from '../../lib/screens/profile';

export const { fieldContext, formContext, useFieldContext, useFormContext } = createFormHookContexts();

export interface BoundFieldProps extends Omit<TextFieldProps, 'value' | 'onChangeText' | 'error'> {
  /** Rewrites what is typed before it is kept: a handle's lowercase, a currency's capitals. */
  format?: (text: string) => string;
  /** Show the field's error from the first change, not only once it's left. */
  errorWhileTyping?: boolean;
}

/** The field's value, changes, blur and shown error, as a TextField takes them. */
const useBoundProps = ({ format, errorWhileTyping, onBlur, ...props }: BoundFieldProps) => {
  const field = useFieldContext<string>();
  const submitted = useStore(field.form.store, (state) => state.submissionAttempts > 0);
  return {
    ...props,
    value: field.state.value,
    onChangeText: (text: string) => field.handleChange(format ? format(text) : text),
    onBlur: (event: Parameters<NonNullable<TextFieldProps['onBlur']>>[0]) => {
      field.handleBlur();
      onBlur?.(event);
    },
    error: visibleError(field.state.meta, submitted, errorWhileTyping),
  };
};

const BoundTextField = forwardRef<TextInput, BoundFieldProps>((props, ref) => (
  <TextField ref={ref} {...useBoundProps(props)} />
));
BoundTextField.displayName = 'BoundTextField';

const BoundPasswordField = forwardRef<TextInput, Omit<BoundFieldProps, 'secureTextEntry' | 'trailing'>>(
  (props, ref) => <PasswordField ref={ref} {...useBoundProps(props)} />,
);
BoundPasswordField.displayName = 'BoundPasswordField';

/**
 * The live username check, for sign-up and adding a profile, as the
 * username field's validators. Once typing pauses the handle is looked up,
 * against the index both profile kinds share, and a taken one blocks saving;
 * saving looks it up again. A lookup that fails blocks nothing, since the
 * database has the last word.
 *
 * `isTaken` is the lookup, `checkUsernameExists` from features/profiles.
 * `current` is the handle the profile already has, when editing one: it is
 * its own, so it's never looked up.
 */
export const useUsernameCheck = (isTaken: (username: string) => Promise<boolean>, current?: string) => {
  const [free] = useState(() => new Set<string>());
  return useMemo(
    () => ({
      validators: {
        onChangeAsyncDebounceMs: USERNAME_CHECK_DEBOUNCE_MS,
        onChangeAsync: async ({ value }: { value: string }) => {
          if (!value || value === current || usernameError(value)) return undefined;
          try {
            if (await isTaken(value)) return HANDLE_TAKEN_MESSAGE;
            free.add(value);
          } catch {
            // Unknown: said nowhere, and blocking nothing.
          }
          return undefined;
        },
      },
      /** Whether the server has said this handle is free. */
      isFree: (username: string) => free.has(username),
    }),
    [free, isTaken, current],
  );
};

export type UsernameCheck = ReturnType<typeof useUsernameCheck>;

/**
 * A username: lowercase as it is typed, its rule said as you type, and the
 * live check's status inside the field — a spinner, then Available or Taken.
 */
const BoundUsernameField = forwardRef<
  TextInput,
  Omit<BoundFieldProps, 'format' | 'errorWhileTyping' | 'trailing'> & { check: UsernameCheck }
>(({ check, ...props }, ref) => {
  const field = useFieldContext<string>();
  const bound = useBoundProps({ ...props, format: (text) => text.toLowerCase(), errorWhileTyping: true });
  const status = usernameStatusFrom({
    username: field.state.value,
    checking: field.state.meta.isValidating,
    taken: field.state.meta.errors.includes(HANDLE_TAKEN_MESSAGE),
    confirmedFree: check.isFree(field.state.value),
  });
  return (
    <TextField
      ref={ref}
      autoCapitalize="none"
      autoCorrect={false}
      {...bound}
      trailing={<UsernameStatus status={status} />}
    />
  );
});
BoundUsernameField.displayName = 'BoundUsernameField';

export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField: BoundTextField,
    PasswordField: BoundPasswordField,
    UsernameField: BoundUsernameField,
  },
  formComponents: {},
});
