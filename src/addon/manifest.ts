import { config } from "../config";
import { getUserByAddonToken } from "../services/userService";
import { listFriends } from "../services/friendService";

interface CatalogEntry {
  type: "movie" | "series";
  id: string;
  name: string;
  extra?: { name: string; isRequired?: boolean }[];
}

/**
 * Builds the JSON manifest object for the Stremio addon.
 * The manifest is dynamic: besides the aggregate "from all friends" catalogs,
 * it adds one catalog per friend (resolved from the token's user).
 */
export async function buildManifest(token?: string) {
  // A personalized URL already carries the token, so it is "configured" and
  // can be installed directly. The base URL (no token) still requires config.
  const configured = Boolean(token);

  const catalogs: CatalogEntry[] = [
    {
      type: "movie",
      id: "sf-friends",
      name: "🎬 Suggested by friends",
      extra: [{ name: "search", isRequired: false }],
    },
    {
      type: "series",
      id: "sf-friends",
      name: "📺 Series from friends",
      extra: [{ name: "search", isRequired: false }],
    },
  ];

  // Per-friend catalogs (only when we can resolve the user from the token).
  if (token) {
    const user = await getUserByAddonToken(token);
    if (user) {
      const friends = await listFriends(user.id);
      for (const f of friends) {
        const name = f.displayName || f.email;
        catalogs.push(
          { type: "movie", id: `sf-friend-${f.id}`, name: `🎬 ${name}` },
          { type: "series", id: `sf-friend-${f.id}`, name: `📺 ${name}` }
        );
      }
    }
  }

  return {
    id: "com.stremiofriends.addon",
    version: "1.0.0",
    name: "Stremio Friends",
    description: "Movies and series suggested by your friends",
    logo: `${config.publicUrl}/logo.png`,
    resources: ["catalog", "meta"],
    types: ["movie", "series"],
    catalogs,
    behaviorHints: { configurable: true, configurationRequired: !configured },
    idPrefixes: ["tt"],
  };
}
