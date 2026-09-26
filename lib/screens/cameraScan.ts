// Pure logic for QR scanning on the camera tab, app/(tabs)/camera.tsx (ONE-29).

import { parseTagUrl } from '../tagLinks';

/**
 * What one barcode read does: the short code to offer, or null to ignore it.
 *
 * `onBarcodeScanned` fires on every frame a code is visible — many times a
 * second — so the code last offered is ignored until detection is re-armed.
 *
 * A QR code is attacker-controlled input: anyone can print one. Only a URL on
 * the trusted tag host, or the app's own scheme, with a well-formed short
 * code is a Tag. Anything else — another site, a Wi-Fi code, plain text —
 * returns null, and the screen stays silent: no error, and no offer to open
 * an arbitrary URL.
 */
export const tagToOffer = (scanned: string, lastOffered: string | null): string | null => {
  const parsed = parseTagUrl(scanned);
  if (!parsed) return null;
  if (parsed.shortCode === lastOffered) return null;
  return parsed.shortCode;
};
