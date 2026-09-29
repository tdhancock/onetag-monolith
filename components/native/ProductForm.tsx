import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { formOptions, useStore } from '@tanstack/react-form';
import { Button, IconButton, MonoLabel, Pressable, Sheet, SheetRow } from './ui';
import { DotsHorizontalIcon, PlusIcon } from './Icons';
import { withForm } from './form';
import { pickImageFromLibrary } from '../../services/mediaPicker';
import { draftValidator } from '../../lib/formErrors';
import {
  EMPTY_PRODUCT_DRAFT,
  newDraftKey,
  PRODUCT_CATEGORY_MAX_LENGTH,
  PRODUCT_DESCRIPTION_MAX_LENGTH,
  PRODUCT_MEDIA_MAX,
  PRODUCT_NAME_MAX_LENGTH,
  PRODUCT_SPECS_MAX,
  productDraftErrors,
  type ProductDraft,
} from '../../lib/screens/products';
import { color, space, type } from '../../theme/tokens';

const validateProduct = draftValidator(productDraftErrors);

/**
 * What Add and Edit build their product form from: the draft's shape, and its
 * rules checked from the start and on every change, so Save waits for a valid
 * draft. Each screen adds its own starting draft and what saving does.
 */
export const productFormOptions = formOptions({
  defaultValues: EMPTY_PRODUCT_DRAFT as ProductDraft,
  validators: { onMount: validateProduct, onChange: validateProduct },
});

/** A photo's or a spec's options, open in the sheet. */
type Selection = { kind: 'photo' | 'spec'; index: number } | null;

const PHOTO_TILE = 88;

/**
 * The fields a product is created and edited with (ONE-40): its photos in the
 * order they show, its name, category and description, a display-only price,
 * and its specs in order. The screen around it owns saving.
 *
 * Order is the owner's to set, since the first photo represents the product
 * everywhere else: each photo and spec opens a sheet to move it or remove it.
 */
const ProductForm = withForm({
  ...productFormOptions,
  render: function ProductFields({ form }) {
    const [selection, setSelection] = useState<Selection>(null);
    const media = useStore(form.store, (state) => state.values.media);
    const specs = useStore(form.store, (state) => state.values.specs);

    const addPhoto = async () => {
      const result = await pickImageFromLibrary({ aspect: [1, 1] });
      if (result.status !== 'selected') return;
      form.pushFieldValue('media', { key: newDraftKey(), uri: result.media.uri });
    };

    const addSpec = () => form.pushFieldValue('specs', { key: newDraftKey(), label: '', value: '' });

    const close = () => setSelection(null);
    const selectedListLength = selection?.kind === 'photo' ? media.length : specs.length;
    const move = (to: number) => {
      if (!selection) return;
      form.moveFieldValues(selection.kind === 'photo' ? 'media' : 'specs', selection.index, to);
      close();
    };
    const remove = () => {
      if (!selection) return;
      void form.removeFieldValue(selection.kind === 'photo' ? 'media' : 'specs', selection.index);
      close();
    };

    return (
      <>
        <View style={styles.section}>
          <MonoLabel color="textMid" style={styles.label}>
            Photos
          </MonoLabel>
          <Text style={styles.hint}>The first photo represents the product everywhere. Tap a photo to move it.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
            {media.map((photo, index) => (
              <Pressable
                key={photo.key}
                onPress={() => setSelection({ kind: 'photo', index })}
                accessibilityRole="button"
                accessibilityLabel={`Photo ${index + 1} of ${media.length}${index === 0 ? ', the cover' : ''}`}
                accessibilityHint="Opens options to move or remove it"
                style={styles.photo}
              >
                <Image source={{ uri: photo.uri }} style={styles.photoImage} contentFit="cover" />
                {index === 0 ? (
                  <View style={styles.cover}>
                    <MonoLabel color="inverse">
                      Cover
                    </MonoLabel>
                  </View>
                ) : null}
              </Pressable>
            ))}
            {media.length < PRODUCT_MEDIA_MAX ? (
              <Pressable
                onPress={() => void addPhoto()}
                accessibilityRole="button"
                accessibilityLabel="Add a photo"
                style={[styles.photo, styles.addPhoto]}
              >
                <PlusIcon color={color.text} size={22} />
                <MonoLabel color="textMid" style={styles.addPhotoLabel}>
                  Add photo
                </MonoLabel>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>

        <View style={[styles.section, styles.fields]}>
          <form.AppField name="name">
            {(field) => (
              <field.TextField
                label="Name"
                placeholder="What it's called"
                maxLength={PRODUCT_NAME_MAX_LENGTH}
                accessibilityLabel="Name"
              />
            )}
          </form.AppField>
          <form.AppField name="category">
            {(field) => (
              <field.TextField
                label="Category"
                placeholder="Optional, e.g. Lighting"
                maxLength={PRODUCT_CATEGORY_MAX_LENGTH}
                accessibilityLabel="Category"
              />
            )}
          </form.AppField>
          <form.AppField name="description">
            {(field) => (
              <field.TextField
                label="Description"
                placeholder="Optional"
                multiline
                maxLength={PRODUCT_DESCRIPTION_MAX_LENGTH}
                inputStyle={styles.description}
                accessibilityLabel="Description"
              />
            )}
          </form.AppField>
          <View>
            <View style={styles.priceRow}>
              <form.AppField name="price">
                {(field) => (
                  <field.TextField
                    label="Price"
                    placeholder="Optional"
                    keyboardType="decimal-pad"
                    containerStyle={styles.price}
                    errorWhileTyping
                    accessibilityLabel="Price"
                  />
                )}
              </form.AppField>
              <form.AppField name="currency">
                {(field) => (
                  <field.TextField
                    label="Currency"
                    format={(value) => value.toUpperCase()}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={3}
                    containerStyle={styles.currency}
                    errorWhileTyping
                    accessibilityLabel="Currency"
                  />
                )}
              </form.AppField>
            </View>
            <Text style={styles.hint}>Shown on the product for information. Nothing is sold through OneTag.</Text>
          </View>
        </View>

        <View style={styles.section}>
          <MonoLabel color="textMid" style={styles.label}>
            Specs
          </MonoLabel>
          {specs.length === 0 ? (
            <Text style={styles.hint}>Details like material, size or finish, as label and value.</Text>
          ) : null}
          {specs.map((spec, index) => (
            <View key={spec.key} style={styles.specRow}>
              <form.AppField name={`specs[${index}].label`}>
                {(field) => (
                  <field.TextField
                    placeholder="Label"
                    containerStyle={styles.specField}
                    accessibilityLabel={`Spec ${index + 1} label`}
                  />
                )}
              </form.AppField>
              <form.AppField name={`specs[${index}].value`}>
                {(field) => (
                  <field.TextField
                    placeholder="Value"
                    containerStyle={styles.specField}
                    accessibilityLabel={`Spec ${index + 1} value`}
                  />
                )}
              </form.AppField>
              <IconButton
                icon={<DotsHorizontalIcon color={color.text} size={20} />}
                accessibilityLabel={`Options for spec ${index + 1}`}
                onPress={() => setSelection({ kind: 'spec', index })}
              />
            </View>
          ))}
          {/* A spec left half filled is said at once: it blocks Save. */}
          <form.Field name="specs" mode="array">
            {(field) => {
              const error = field.state.meta.errors.find((e): e is string => typeof e === 'string');
              return error ? <Text style={styles.error}>{error}</Text> : null;
            }}
          </form.Field>
          {specs.length < PRODUCT_SPECS_MAX ? (
            <Button variant="outline" size="sm" onPress={addSpec} style={styles.addSpec}>
              Add a spec
            </Button>
          ) : null}
        </View>

        <Sheet visible={selection !== null} onClose={close}>
          {selection && selection.index > 0 ? (
            <>
              {selection.kind === 'photo' ? <SheetRow label="Make it the cover" onPress={() => move(0)} /> : null}
              <SheetRow label="Move earlier" onPress={() => move(selection.index - 1)} />
            </>
          ) : null}
          {selection && selection.index < selectedListLength - 1 ? (
            <SheetRow label="Move later" onPress={() => move(selection.index + 1)} />
          ) : null}
          <SheetRow label={selection?.kind === 'photo' ? 'Remove photo' : 'Remove spec'} destructive onPress={remove} />
        </Sheet>
      </>
    );
  },
});

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  fields: {
    gap: space.lg,
  },
  label: {
    marginBottom: space.xs,
  },
  hint: {
    marginTop: space.xs,
    fontFamily: type.body,
    fontSize: 13,
    lineHeight: 18,
    color: color.textMid,
  },
  photos: {
    gap: space.sm,
    paddingTop: space.md,
  },
  photo: {
    width: PHOTO_TILE,
    height: PHOTO_TILE,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.bgPanel,
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  cover: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    paddingHorizontal: space.xs,
    paddingVertical: 2,
    backgroundColor: color.text,
  },
  addPhoto: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.bg,
  },
  addPhotoLabel: {
    marginTop: space.xs,
  },
  description: {
    minHeight: 110,
  },
  priceRow: {
    flexDirection: 'row',
    gap: space.sm,
  },
  price: {
    flex: 2,
  },
  currency: {
    flex: 1,
  },
  specRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.sm,
  },
  specField: {
    flex: 1,
  },
  error: {
    marginTop: space.xs,
    fontFamily: type.body,
    fontSize: 13,
    color: color.heart,
  },
  addSpec: {
    marginTop: space.md,
    alignSelf: 'flex-start',
  },
});

export default ProductForm;
