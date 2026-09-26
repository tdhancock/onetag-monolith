// Sharing a Product or a Project (ONE-40, ONE-41): its name and a link that
// opens it in the app.
//
// The link is the app's own — `onetag://product/<id>` in a build — and not a
// web address, on purpose. Web is a thin surface that resolves Tags and
// nothing else (Working Agreement §5), so an https link to a product would
// open a page that does not exist for anyone without the app. What reaches
// someone without the app is a Tag, and a Tag's link is built only in
// lib/tagLinks.ts.
//
// expo-linking builds it from app.json's `scheme`, so the scheme is not
// repeated here; in Expo Go the same call points at the development server.

import { Platform, Share } from 'react-native';
import * as Linking from 'expo-linking';

/** The link that opens one of the app's own routes, e.g. `/product/<id>`. */
export const appLinkTo = (route: string): string => Linking.createURL(route.replace(/^\/+/, ''));

export interface ShareableDestination {
  /** What the recipient reads first: the product's or project's name. */
  title: string;
  /** Its route in the app. */
  route: string;
}

/**
 * Open the native share sheet with a Destination's name and link. iOS takes
 * the link as a `url` beside the message; Android's share sheet takes text
 * only, so there the link goes in the message.
 */
export const shareDestination = async ({ title, route }: ShareableDestination): Promise<void> => {
  const url = appLinkTo(route);
  await Share.share(Platform.OS === 'ios' ? { message: title, url } : { message: `${title}\n${url}` });
};
