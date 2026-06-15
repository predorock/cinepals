// Shared types used across the whole project.

// --- Express augmentation: req.user set by the requireAuth middleware ---
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export interface AuthUser {
  id: string;
  email: string;
}

// --- Stremio protocol types ---
export type StremioContentType = "movie" | "series";

export interface StremioMetaPreview {
  id: string; // IMDb id, e.g. "tt0133093"
  type: StremioContentType;
  name: string;
  poster?: string;
  posterShape?: "poster" | "landscape" | "square";
  description?: string;
  releaseInfo?: string;
}

export interface StremioMeta extends StremioMetaPreview {
  background?: string;
  genres?: string[];
}

export interface StremioCatalogResponse {
  metas: StremioMetaPreview[];
}

export interface StremioMetaResponse {
  meta: StremioMeta | null;
}

// --- Normalized TMDB search result ---
export interface TitleSearchResult {
  imdbId: string;
  type: StremioContentType;
  name: string;
  year?: string;
  poster?: string;
  description?: string;
}

export {};
