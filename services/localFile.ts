// Reading a local file for upload, in one place.
//
// `fetch()` + `arrayBuffer()` is the React Native path: it works for file://
// and content:// URIs, where `.blob()` does not, because RN's Blob is a shim
// with no accessible binary data. Every upload path shares this so none of
// them can drift back onto `.blob()` and silently upload nothing.
//
// Extracted from the old shared service module in ONE-15, unchanged, so
// `features/profiles` can upload an avatar without importing that module.

/**
 * Read a local media URI into an ArrayBuffer, alongside the content type and
 * extension implied by the URI. This is the React Native path — `fetch()` +
 * `arrayBuffer()` works for file:// and content:// URIs, where `.blob()` does
 * not, because RN's Blob is a shim with no accessible binary data.
 *
 * Shared by every upload path so none of them can drift back onto `.blob()`.
 */
export async function readLocalFile(localUri: string): Promise<{ arrayBuffer: ArrayBuffer; contentType: string; ext: string }> {
    const response = await fetch(localUri);
    if (!response.ok) {
        throw new Error(`Failed to read local file: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();

    // Determine content type from URI extension
    const uriLower = localUri.toLowerCase();
    let contentType = 'image/jpeg'; // default
    let ext = 'jpg';
    if (uriLower.endsWith('.png')) { contentType = 'image/png'; ext = 'png'; }
    else if (uriLower.endsWith('.webp')) { contentType = 'image/webp'; ext = 'webp'; }
    else if (uriLower.endsWith('.gif')) { contentType = 'image/gif'; ext = 'gif'; }
    else if (uriLower.endsWith('.mp4')) { contentType = 'video/mp4'; ext = 'mp4'; }
    else if (uriLower.endsWith('.mov')) { contentType = 'video/quicktime'; ext = 'mov'; }

    return { arrayBuffer, contentType, ext };
}
