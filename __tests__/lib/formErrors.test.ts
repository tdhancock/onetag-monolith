//
// target: __tests__/lib/formErrors.test.ts
// How a draft's rules reach TanStack Form, and when a field shows its error —
// lib/formErrors.

import { draftValidator, visibleError } from '../../lib/formErrors';

describe('draftValidator', () => {
  const validate = draftValidator((d: { name: string; price: string }) => ({
    name: d.name ? null : 'Give it a name.',
    price: /^\d*$/.test(d.price) ? undefined : 'Not a price.',
  }));

  it('hands the form nothing for a valid draft', () => {
    expect(validate({ value: { name: 'Lamp', price: '12' } })).toBeUndefined();
  });

  it('hands the form each field that has an error, and only those', () => {
    expect(validate({ value: { name: '', price: '12' } })).toEqual({ fields: { name: 'Give it a name.' } });
    expect(validate({ value: { name: '', price: 'x' } })).toEqual({
      fields: { name: 'Give it a name.', price: 'Not a price.' },
    });
  });
});

describe('visibleError', () => {
  const meta = (m: Partial<{ errors: unknown[]; isTouched: boolean; isBlurred: boolean }>) => ({
    errors: ['Too short.'],
    isTouched: false,
    isBlurred: false,
    ...m,
  });

  it('waits until the field is left, so nobody is told off mid-word', () => {
    expect(visibleError(meta({ isTouched: true }), false)).toBeNull();
    expect(visibleError(meta({ isTouched: true, isBlurred: true }), false)).toBe('Too short.');
  });

  it('shows every error once a save was tried', () => {
    expect(visibleError(meta({}), true)).toBe('Too short.');
  });

  it('shows it from the first change for a rule worth knowing as you type', () => {
    expect(visibleError(meta({ isTouched: true }), false, true)).toBe('Too short.');
    expect(visibleError(meta({}), false, true)).toBeNull();
  });

  it('shows the first message, and nothing for a field without one', () => {
    expect(visibleError(meta({ errors: [undefined, 'First.', 'Second.'], isBlurred: true }), false)).toBe('First.');
    expect(visibleError(meta({ errors: [], isBlurred: true }), false)).toBeNull();
  });
});
