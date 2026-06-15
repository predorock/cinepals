import { config } from "../config";
import { prisma } from "../db";
import type {
  StremioContentType,
  StremioMeta,
  StremioMetaPreview,
  TitleSearchResult,
} from "../types";

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG = (path: string | null | undefined, size: string) =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;

// Stremio's official, keyless artwork service (poster/background by IMDb id).
const metahubPoster = (imdbId: string) =>
  `https://images.metahub.space/poster/medium/${imdbId}/img`;
const metahubBackground = (imdbId: string) =>
  `https://images.metahub.space/background/medium/${imdbId}/img`;

// Curated fallback used for local development when TMDB_API_KEY is not set,
// so the welcome catalog and detail pages work without any API key.
interface FallbackTitle {
  imdbId: string;
  type: StremioContentType;
  name: string;
  year: string;
}

const FALLBACK_TITLES: FallbackTitle[] = [
  { imdbId: "tt0111161", type: "movie", name: "The Shawshank Redemption", year: "1994" },
  { imdbId: "tt0468569", type: "movie", name: "The Dark Knight", year: "2008" },
  { imdbId: "tt1375666", type: "movie", name: "Inception", year: "2010" },
  { imdbId: "tt0137523", type: "movie", name: "Fight Club", year: "1999" },
  { imdbId: "tt0109830", type: "movie", name: "Forrest Gump", year: "1994" },
  { imdbId: "tt0133093", type: "movie", name: "The Matrix", year: "1999" },
  { imdbId: "tt0816692", type: "movie", name: "Interstellar", year: "2014" },
  { imdbId: "tt0110912", type: "movie", name: "Pulp Fiction", year: "1994" },
  { imdbId: "tt0120737", type: "movie", name: "The Lord of the Rings: The Fellowship of the Ring", year: "2001" },
  { imdbId: "tt4154796", type: "movie", name: "Avengers: Endgame", year: "2019" },
  { imdbId: "tt0903747", type: "series", name: "Breaking Bad", year: "2008" },
  { imdbId: "tt0944947", type: "series", name: "Game of Thrones", year: "2011" },
  { imdbId: "tt0108778", type: "series", name: "Friends", year: "1994" },
  { imdbId: "tt4574334", type: "series", name: "Stranger Things", year: "2016" },
  { imdbId: "tt2861424", type: "series", name: "Rick and Morty", year: "2013" },
  { imdbId: "tt1475582", type: "series", name: "Sherlock", year: "2010" },
  { imdbId: "tt5491994", type: "series", name: "Planet Earth II", year: "2016" },
  { imdbId: "tt7366338", type: "series", name: "Chernobyl", year: "2019" },
];

function fallbackPreview(t: FallbackTitle): StremioMetaPreview {
  return {
    id: t.imdbId,
    type: t.type,
    name: t.name,
    poster: metahubPoster(t.imdbId),
    posterShape: "poster",
    releaseInfo: t.year,
  };
}

interface TmdbSearchItem {
  id: number;
  title?: string; // movie
  name?: string; // tv
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string; // movie
  first_air_date?: string; // tv
}

async function tmdbFetch<T>(path: string, params: Record<string, string>): Promise<T | null> {
  if (!config.tmdbApiKey) {
    console.warn("TMDB_API_KEY not configured: search/metadata unavailable.");
    return null;
  }
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set("api_key", config.tmdbApiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  if (!res.ok) {
    console.error(`TMDB ${path} -> ${res.status}`);
    return null;
  }
  return (await res.json()) as T;
}

/**
 * Persists a title's metadata into the cache the first time we see it (e.g. at
 * search time), so later lookups (suggestion lists, addon meta) need no TMDB
 * call. Never overwrites an existing entry, which may be richer.
 */
async function cacheTitle(
  imdbId: string,
  type: StremioContentType,
  item: TmdbSearchItem
): Promise<void> {
  const date = item.release_date || item.first_air_date || "";
  await prisma.titleCache
    .upsert({
      where: { imdbId },
      update: {}, // keep the existing (possibly fuller) entry untouched
      create: {
        imdbId,
        type,
        name: item.title || item.name || "Untitled",
        poster: IMG(item.poster_path, "w500"),
        background: IMG(item.backdrop_path, "w1280"),
        description: item.overview || undefined,
        releaseInfo: date ? date.slice(0, 4) : undefined,
      },
    })
    .catch(() => {
      /* best-effort cache; ignore races/errors */
    });
}

/** Searches movies/series on TMDB and resolves IMDb IDs (required by Stremio). */
export async function searchTitles(
  query: string,
  type: StremioContentType = "movie",
  limit = 10
): Promise<TitleSearchResult[]> {
  const endpoint = type === "movie" ? "/search/movie" : "/search/tv";
  const data = await tmdbFetch<{ results: TmdbSearchItem[] }>(endpoint, { query });
  if (!data?.results?.length) return [];

  const top = data.results.slice(0, limit);
  const resolved = await Promise.all(
    top.map(async (item): Promise<TitleSearchResult | null> => {
      const imdbId = await getImdbId(item.id, type);
      if (!imdbId) return null;
      // Cache the title now so suggestion lists/meta never need to re-fetch it.
      await cacheTitle(imdbId, type, item);
      const date = item.release_date || item.first_air_date || "";
      return {
        imdbId,
        type,
        name: item.title || item.name || "Untitled",
        year: date ? date.slice(0, 4) : undefined,
        poster: IMG(item.poster_path, "w342"),
        description: item.overview || undefined,
      };
    })
  );
  return resolved.filter((r): r is TitleSearchResult => r !== null);
}

/**
 * Popular movies/series from TMDB, returned as Stremio catalog previews.
 * Used as a "welcome" catalog when the user has no friend suggestions yet.
 */
export async function getPopularTitles(
  type: StremioContentType = "movie",
  limit = 20
): Promise<StremioMetaPreview[]> {
  // No API key (local dev): use the curated keyless fallback list.
  if (!config.tmdbApiKey) {
    return FALLBACK_TITLES.filter((t) => t.type === type)
      .slice(0, limit)
      .map(fallbackPreview);
  }

  const endpoint = type === "movie" ? "/movie/popular" : "/tv/popular";
  const data = await tmdbFetch<{ results: TmdbSearchItem[] }>(endpoint, {});
  if (!data?.results?.length) return [];

  const top = data.results.slice(0, limit);
  const resolved = await Promise.all(
    top.map(async (item): Promise<StremioMetaPreview | null> => {
      const imdbId = await getImdbId(item.id, type);
      if (!imdbId) return null;
      const date = item.release_date || item.first_air_date || "";
      return {
        id: imdbId,
        type,
        name: item.title || item.name || "Untitled",
        poster: IMG(item.poster_path, "w342"),
        posterShape: "poster",
        releaseInfo: date ? date.slice(0, 4) : undefined,
        description: item.overview || undefined,
      };
    })
  );
  return resolved.filter((m): m is StremioMetaPreview => m !== null);
}

/** IMDb ID from a TMDB id. */
async function getImdbId(tmdbId: number, type: StremioContentType): Promise<string | null> {
  const path = type === "movie" ? `/movie/${tmdbId}/external_ids` : `/tv/${tmdbId}/external_ids`;
  const data = await tmdbFetch<{ imdb_id?: string | null }>(path, {});
  return data?.imdb_id || null;
}

/**
 * Full Stremio metadata from an IMDb ID.
 * Uses the DB cache; on a miss queries TMDB via /find and populates the cache.
 */
export async function getMetaByImdbId(
  imdbId: string,
  type: StremioContentType
): Promise<StremioMeta | null> {
  const cached = await prisma.titleCache.findUnique({ where: { imdbId } });
  if (cached) {
    return {
      id: cached.imdbId,
      type: cached.type as StremioContentType,
      name: cached.name,
      poster: cached.poster ?? undefined,
      background: cached.background ?? undefined,
      description: cached.description ?? undefined,
      releaseInfo: cached.releaseInfo ?? undefined,
    };
  }

  // No API key (local dev): build metadata from the fallback list + keyless artwork.
  if (!config.tmdbApiKey) {
    const fb = FALLBACK_TITLES.find((t) => t.imdbId === imdbId);
    return {
      id: imdbId,
      type,
      name: fb?.name ?? imdbId,
      poster: metahubPoster(imdbId),
      background: metahubBackground(imdbId),
      releaseInfo: fb?.year,
    };
  }

  const data = await tmdbFetch<{
    movie_results: TmdbFindItem[];
    tv_results: TmdbFindItem[];
  }>(`/find/${imdbId}`, { external_source: "imdb_id" });

  const item = type === "movie" ? data?.movie_results?.[0] : data?.tv_results?.[0];
  if (!item) return null;

  const date = item.release_date || item.first_air_date || "";
  const meta: StremioMeta = {
    id: imdbId,
    type,
    name: item.title || item.name || "Untitled",
    poster: IMG(item.poster_path, "w500"),
    background: IMG(item.backdrop_path, "w1280"),
    description: item.overview || undefined,
    releaseInfo: date ? date.slice(0, 4) : undefined,
  };

  await prisma.titleCache
    .create({
      data: {
        imdbId,
        type,
        name: meta.name,
        poster: meta.poster,
        background: meta.background,
        description: meta.description,
        releaseInfo: meta.releaseInfo,
      },
    })
    .catch(() => {
      /* concurrent cache race: ignore duplicates */
    });

  return meta;
}

interface TmdbFindItem {
  id: number;
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
}
