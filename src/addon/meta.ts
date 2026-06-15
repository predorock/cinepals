import { getMetaByImdbId } from "../lib/tmdb";
import type { StremioContentType, StremioMeta } from "../types";

/**
 * Builds the Stremio `meta` response for a single title,
 * fetching the metadata (cached) starting from the IMDb ID.
 */
export async function buildMeta(
  type: StremioContentType,
  imdbId: string
): Promise<{ meta: StremioMeta | null }> {
  const meta = await getMetaByImdbId(imdbId, type);
  return { meta };
}
