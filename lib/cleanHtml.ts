// Strip markup from user-entered text before it is stored.
//
// A pure utility, moved out of the old shared service module in ONE-20. React Native
// has no DOMParser, so the regex path is the one the app actually runs; the
// DOMParser branch covers the jsdom test environment.

export const cleanHtml = (html: string): string => {
  if (!html) return '';

  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || '';
  }

  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};
