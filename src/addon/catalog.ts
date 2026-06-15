import { getUserByAddonToken } from "../services/userService";
import { getReceivedByType } from "../services/suggestionService";
import { getMetaByImdbId, getPopularTitles } from "../lib/tmdb";
import type {
  StremioCatalogResponse,
  StremioContentType,
  StremioMetaPreview,
} from "../types";

/**
 * Builds the Stremio catalog for a user identified by their addon token.
 * Resolves the received (non-dismissed) suggestions of the requested type, fetches
 * their metadata from TMDB in parallel and enriches the description with the
 * suggestion's author. If a search query is present, filters by name.
 */
export async function buildCatalog(
  token: string,
  type: StremioContentType,
  searchQuery?: string,
  friendId?: string
): Promise<StremioCatalogResponse> {
  const user = await getUserByAddonToken(token);
  if (!user) return { metas: [] };

  const suggestions = await getReceivedByType(user.id, type, friendId);

  const resolved = await Promise.all(
    suggestions.map(async (s): Promise<StremioMetaPreview | null> => {
      const meta = await getMetaByImdbId(s.imdbId, type);
      if (!meta) return null;

      const author = s.fromUser.displayName || s.fromUser.email;
      const noteSuffix = s.note ? `: "${s.note}"` : "";
      const description = `Suggested by ${author}${noteSuffix}`;

      return {
        id: meta.id,
        type,
        name: meta.name,
        poster: meta.poster,
        posterShape: "poster",
        description,
        releaseInfo: meta.releaseInfo,
      };
    })
  );

  let metas = resolved.filter((m): m is StremioMetaPreview => m !== null);

  // Welcome catalog: only on the aggregate catalog (no specific friend),
  // if the user has no suggestions yet and isn't searching, show popular titles.
  if (metas.length === 0 && !searchQuery && !friendId) {
    const popular = await getPopularTitles(type);
    return {
      metas: popular.map((m) => ({
        ...m,
        description: `Popular now — add friends to get personal recommendations. ${m.description ?? ""}`.trim(),
      })),
    };
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    metas = metas.filter((m) => m.name.toLowerCase().includes(q));
  }

  return { metas };
}
