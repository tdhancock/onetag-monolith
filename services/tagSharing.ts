// Getting a Tag off the phone (ONE-32, ONE-33): its link copied or shared,
// and its QR code saved to Photos or shared as an image.
//
// Callers pass a short code, never a URL. Every link is built here by
// lib/tagLinks.ts's buildTagUrl, so nothing can share a wrong or stale domain.

import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { File, Paths } from 'expo-file-system';
import { buildTagUrl } from '../lib/tagLinks';

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

/** A rendered QR code's Svg, as react-native-svg hands it to `getRef`. */
export interface QrSvgHandle {
  toDataURL: (callback: (base64: string) => void, options?: { width: number; height: number }) => void;
}

/**
 * The exported image's width and height, in pixels. A QR captured at its
 * on-screen size prints blurry; this is drawn from the vector at print
 * resolution, whatever size the preview is.
 */
export const TAG_QR_EXPORT_PX = 1200;

/** How long to wait for the native renderer before calling an export failed. */
const EXPORT_TIMEOUT_MS = 10_000;

/** A QR code as a base64 PNG, `px` square (quiet zone included). */
export const qrPngBase64 = (svg: QrSvgHandle, px: number = TAG_QR_EXPORT_PX): Promise<string> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The QR code could not be rendered.')), EXPORT_TIMEOUT_MS);
    try {
      svg.toDataURL(
        (base64) => {
          clearTimeout(timer);
          resolve(base64);
        },
        { width: px, height: px },
      );
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });

/** Where a QR export is written before it is saved or shared. */
const writeQrPng = (base64Png: string, shortCode: string): string => {
  const file = new File(Paths.cache, `onetag-${shortCode}.png`);
  file.create({ overwrite: true });
  file.write(base64Png, { encoding: 'base64' });
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
export const saveTagQrToPhotos = async (base64Png: string, shortCode: string): Promise<SaveToPhotosResult> => {
  const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
  if (!permission.granted) return 'denied';

  await MediaLibrary.Asset.create(writeQrPng(base64Png, shortCode));
  return 'saved';
};

/**
 * Share a QR export as an image through the native share sheet. Needs no
 * permission. Where the platform cannot share a file, the link goes instead.
 */
export const shareTagQrImage = async (base64Png: string, shortCode: string): Promise<void> => {
  if (!(await Sharing.isAvailableAsync())) {
    await shareTagLink(shortCode);
    return;
  }
  await Sharing.shareAsync(writeQrPng(base64Png, shortCode), {
    mimeType: 'image/png',
    UTI: 'public.png',
    dialogTitle: 'Share QR code',
  });
};
