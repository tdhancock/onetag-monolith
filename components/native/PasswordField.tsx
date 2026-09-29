import React, { forwardRef, useState } from 'react';
import type { TextInput } from 'react-native';
import { IconButton, TextField } from './ui';
import type { TextFieldProps } from './ui';
import { EyeIcon, EyeSlashIcon } from './Icons';
import { color } from '../../theme/tokens';

/**
 * A TextField for a password, with a show/hide control inside its trailing
 * edge. Everything else — autofill hints, return key — is the caller's.
 */
const PasswordField = forwardRef<TextInput, Omit<TextFieldProps, 'secureTextEntry' | 'trailing'>>(
  (props, ref) => {
    const [visible, setVisible] = useState(false);
    return (
      <TextField
        ref={ref}
        {...props}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        trailing={
          <IconButton
            icon={
              visible ? (
                <EyeSlashIcon color={color.textMid} size={20} strokeWidth={1.6} />
              ) : (
                <EyeIcon color={color.textMid} size={20} strokeWidth={1.6} />
              )
            }
            accessibilityLabel={visible ? 'Hide password' : 'Show password'}
            onPress={() => setVisible(v => !v)}
          />
        }
      />
    );
  },
);

PasswordField.displayName = 'PasswordField';

export default PasswordField;
