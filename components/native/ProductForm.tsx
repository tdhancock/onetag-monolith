import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Button, IconButton, MonoLabel, Pressable, Sheet, SheetRow, TextField } from './ui';
import { DotsHorizontalIcon, PlusIcon } from './Icons';
import { pickImageFromLibrary } from '../../services/mediaPicker';
import {
  moveItem,
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

export interface ProductFormProps {
  draft: ProductDraft;
  onChange: (draft: ProductDraft) => void;
}

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
const ProductForm: React.FC<ProductFormProps> = ({ draft, onChange }) => {
  const [selection, setSelection] = useState<Selection>(null);
  const [nameTouched, setNameTouched] = useState(false);
  const errors = productDraftErrors(draft);

  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => onChange({ ...draft, [key]: value });

  const addPhoto = async () => {
    const result = await pickImageFromLibrary({ aspect: [1, 1] });
    if (result.status !== 'selected') return;
    onChange({ ...draft, media: [...draft.media, { key: newDraftKey(), uri: result.media.uri }] });
  };

  const setSpec = (index: number, field: 'label' | 'value', value: string) =>
    set(
      'specs',
      draft.specs.map((spec, i) => (i === index ? { ...spec, [field]: value } : spec)),
    );

  const addSpec = () => set('specs', [...draft.specs, { key: newDraftKey(), label: '', value: '' }]);

  const close = () => setSelection(null);
  const selectedListLength = selection?.kind === 'photo' ? draft.media.length : draft.specs.length;
  const move = (to: number) => {
    if (!selection) return;
    if (selection.kind === 'photo') set('media', moveItem(draft.media, selection.index, to));
    else set('specs', moveItem(draft.specs, selection.index, to));
    close();
  };
  const remove = () => {
    if (!selection) return;
    if (selection.kind === 'photo') set('media', draft.media.filter((_, i) => i !== selection.index));
    else set('specs', draft.specs.filter((_, i) => i !== selection.index));
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
          {draft.media.map((media, index) => (
            <Pressable
              key={media.key}
              onPress={() => setSelection({ kind: 'photo', index })}
              accessibilityRole="button"
              accessibilityLabel={`Photo ${index + 1} of ${draft.media.length}${index === 0 ? ', the cover' : ''}`}
              accessibilityHint="Opens options to move or remove it"
              style={styles.photo}
            >
              <Image source={{ uri: media.uri }} style={styles.photoImage} contentFit="cover" />
              {index === 0 ? (
                <View style={styles.cover}>
                  <MonoLabel color="inverse">
                    Cover
                  </MonoLabel>
                </View>
              ) : null}
            </Pressable>
          ))}
          {draft.media.length < PRODUCT_MEDIA_MAX ? (
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
        <TextField
          label="Name"
          value={draft.name}
          onChangeText={(value) => set('name', value)}
          onBlur={() => setNameTouched(true)}
          placeholder="What it's called"
          maxLength={PRODUCT_NAME_MAX_LENGTH}
          error={nameTouched ? errors.name : null}
          accessibilityLabel="Name"
        />
        <TextField
          label="Category"
          value={draft.category}
          onChangeText={(value) => set('category', value)}
          placeholder="Optional, e.g. Lighting"
          maxLength={PRODUCT_CATEGORY_MAX_LENGTH}
          accessibilityLabel="Category"
        />
        <TextField
          label="Description"
          value={draft.description}
          onChangeText={(value) => set('description', value)}
          placeholder="Optional"
          multiline
          maxLength={PRODUCT_DESCRIPTION_MAX_LENGTH}
          inputStyle={styles.description}
          accessibilityLabel="Description"
        />
        <View>
          <View style={styles.priceRow}>
            <TextField
              label="Price"
              value={draft.price}
              onChangeText={(value) => set('price', value)}
              placeholder="Optional"
              keyboardType="decimal-pad"
              containerStyle={styles.price}
              error={errors.price}
              accessibilityLabel="Price"
            />
            <TextField
              label="Currency"
              value={draft.currency}
              onChangeText={(value) => set('currency', value.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={3}
              containerStyle={styles.currency}
              error={errors.currency}
              accessibilityLabel="Currency"
            />
          </View>
          <Text style={styles.hint}>Shown on the product for information. Nothing is sold through OneTag.</Text>
        </View>
      </View>

      <View style={styles.section}>
        <MonoLabel color="textMid" style={styles.label}>
          Specs
        </MonoLabel>
        {draft.specs.length === 0 ? (
          <Text style={styles.hint}>Details like material, size or finish, as label and value.</Text>
        ) : null}
        {draft.specs.map((spec, index) => (
          <View key={spec.key} style={styles.specRow}>
            <TextField
              value={spec.label}
              onChangeText={(value) => setSpec(index, 'label', value)}
              placeholder="Label"
              containerStyle={styles.specField}
              accessibilityLabel={`Spec ${index + 1} label`}
            />
            <TextField
              value={spec.value}
              onChangeText={(value) => setSpec(index, 'value', value)}
              placeholder="Value"
              containerStyle={styles.specField}
              accessibilityLabel={`Spec ${index + 1} value`}
            />
            <IconButton
              icon={<DotsHorizontalIcon color={color.text} size={20} />}
              accessibilityLabel={`Options for spec ${index + 1}`}
              onPress={() => setSelection({ kind: 'spec', index })}
            />
          </View>
        ))}
        {errors.specs ? <Text style={styles.error}>{errors.specs}</Text> : null}
        {draft.specs.length < PRODUCT_SPECS_MAX ? (
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
};

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
