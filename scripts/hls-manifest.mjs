export async function hasPlayableHlsManifest(playbackUrl, fetchImpl = fetch) {
  const response = await fetchImpl(playbackUrl, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) return false;

  const lines = (await response.text()).trim().split(/\r?\n/).map(line => line.trim());
  if (lines[0] !== "#EXTM3U") return false;
  if (lines.some(line => line.startsWith("#EXTINF:"))) return true;

  const variantIndex = lines.findIndex(line => line.startsWith("#EXT-X-STREAM-INF:"));
  const variantPath = lines[variantIndex + 1];
  if (variantIndex === -1 || !variantPath || variantPath.startsWith("#")) return false;

  const variantUrl = new URL(variantPath, response.url || String(playbackUrl));
  const variant = await fetchImpl(variantUrl, { signal: AbortSignal.timeout(8000) });
  if (!variant.ok) return false;

  const mediaLines = (await variant.text()).trim().split(/\r?\n/).map(line => line.trim());
  return mediaLines[0] === "#EXTM3U" && mediaLines.some(line => line.startsWith("#EXTINF:"));
}
