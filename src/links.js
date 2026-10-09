// Preserve the server result (and its provenance digest) unchanged. Add usable
// website URLs separately so relative paths do not resolve against localhost DSH.
export function websiteLinks(result, base) {
  const links = [];
  function visit(value, path) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const field = `${path}/${key}`;
      if (['url', 'href', 'launcherUrl'].includes(key) && typeof child === 'string') {
        try {
          const url = new URL(child, base);
          if (child && !/[\x00-\x20\\]/.test(child) && url.origin === base.origin &&
              ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
            links.push({ field, url: url.href });
          }
        } catch { /* Invalid source links are not promoted into actionable links. */ }
      } else visit(child, field);
    }
  }
  visit(result, '/result');
  return links;
}
