// Getting a Tag off the phone (ONE-32, ONE-33): its link copied or shared,
// and its QR code saved to Photos or shared as an image — or a sheet of
// blank tags' codes, for printing (ONE-138).
//
// Callers pass a short code, never a URL. Every link is built here by
// lib/tagLinks.ts's buildTagUrl, so nothing can share a wrong or stale domain.

import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { File, Paths } from 'expo-file-system';
import { buildTagUrl } from '../lib/tagLinks';
import { tagQrPng } from '../lib/tagQr';
import { tagSheetPng } from '../lib/tagSheet';

/** Put a tag's link on the clipboard. */
export const copyTagLink = async (shortCode: string): Promise<void> => {
  await Clipboard.setStringAsync(buildTagUrl(shortCode));
};

/**
 * Open the native share sheet with a tag's link. iOS shares a `url` as a
 * link; Android's share sheet takes text only, so there it is the message.
 */
export const shareTagLink = async (shortCode: string): Promise<void> => {
  const url = buildTagUrl(shortCode);
  await Share.share(Platform.OS === 'ios' ? { url } : { message: url });
};

/**
 * A tag's QR code, drawn at print resolution (lib/tagQr.ts) and written where
 * it is saved or shared from. The image is built from the code itself, not
 * captured from the preview, so its size on screen doesn't matter.
 */
const writeQrPng = (shortCode: string): string => {
  const file = new File(Paths.cache, `onetag-${shortCode}.png`);
  file.create({ overwrite: true });
  file.write(tagQrPng(shortCode).png);
  return file.uri;
};

export type SaveToPhotosResult = 'saved' | 'denied';

/**
 * Save a QR export to the camera roll.
 *
 * Permission is asked for here, at the moment of use, never on mount — and
 * write-only, since saving needs no read access to anyone's photos. A refusal
 * is a result, not an error: the screen explains it and Share still works.
 */
export const saveTagQrToPhotos = async (shortCode: string): Promise<SaveToPhotosResult> => {
  const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
  if (!permission.granted) return 'denied';

  await MediaLibrary.Asset.create(writeQrPng(shortCode));
  return 'saved';
};

/**
 * Share a QR export as an image through the native share sheet. Needs no
 * permission. Where the platform cannot share a file, the link goes instead.
 */
export const shareTagQrImage = async (shortCode: string): Promise<void> => {
  if (!(await Sharing.isAvailableAsync())) {
    await shareTagLink(shortCode);
    return;
  }
  await Sharing.shareAsync(writeQrPng(shortCode), {
    mimeType: 'image/png',
    UTI: 'public.png',
    dialogTitle: 'Share QR code',
  });
};

// ─── Sheets of blank tags (ONE-138) ─────────────────────────────────────

/** One sheet of codes (lib/tagSheet.ts), written where it is saved or shared from. */
const writeSheetPng = (shortCodes: string[]): string => {
  const file = new File(Paths.cache, `onetag-sheet-${shortCodes[0]}.png`);
  file.create({ overwrite: true });
  file.write(tagSheetPng(shortCodes).png);
  return file.uri;
};

/**
 * Save sheets of codes to the camera roll, one image a sheet. Permission is
 * asked for at the moment of use and write-only, as for a single code.
 */
export const saveTagSheetsToPhotos = async (sheets: string[][]): Promise<SaveToPhotosResult> => {
  const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
  if (!permission.granted) return 'denied';

  for (const sheet of sheets) await MediaLibrary.Asset.create(writeSheetPng(sheet));
  return 'saved';
};

/**
 * Share one sheet as an image through the native share sheet — to a printer,
 * or a computer to print from. Where the platform cannot share a file, the
 * sheet's links go instead, one a line.
 */
export const shareTagSheet = async (shortCodes: string[]): Promise<void> => {
  if (!(await Sharing.isAvailableAsync())) {
    await Share.share({ message: shortCodes.map(buildTagUrl).join('\n') });
    return;
  }
  await Sharing.shareAsync(writeSheetPng(shortCodes), {
    mimeType: 'image/png',
    UTI: 'public.png',
    dialogTitle: 'Share sheet of tags',
  });
};
