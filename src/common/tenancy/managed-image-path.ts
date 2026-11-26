// Only recognize the canonical managed image key, never arbitrary relative URLs.
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const pattern = new RegExp("^/r/(" + uuid + ")/(" + uuid + ")\\.webp$", "i");

export function managedImagePath(url: string | null, restaurantId: string, publicOrigin: string | null | undefined, assetId?: string | null): string | null {
  if (!url || !publicOrigin) return null;
  try {
    const parsed = new URL(url);
    if (parsed.origin !== publicOrigin || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    const match = pattern.exec(parsed.pathname);
    if (!match || match[1].toLowerCase() !== restaurantId.toLowerCase()) return null;
    if (assetId && match[2].toLowerCase() !== assetId.toLowerCase()) return null;
    return parsed.pathname;
  } catch { return null; }
}
