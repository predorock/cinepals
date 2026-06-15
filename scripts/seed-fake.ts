/**
 * Dev seed: creates fake friends and recommendations for a target user.
 *
 * Usage (loads .env.local for DATABASE_URL):
 *   pnpm exec tsx scripts/seed-fake.ts [recipientEmail]
 *
 * Idempotent: re-running upserts the same users/friendships and skips
 * duplicate suggestions. Real IMDb IDs are used so titles resolve via TMDB.
 */
import { prisma } from "../src/db";
import { generateToken } from "../src/lib/tokens";

const RECIPIENT_EMAIL = (process.argv[2] || "demo@example.com").toLowerCase();

const FRIENDS = [
  { email: "alice@example.com", displayName: "Alice Romano" },
  { email: "marco@example.com", displayName: "Marco Bianchi" },
  { email: "sofia@example.com", displayName: "Sofia Greco" },
  { email: "luca@example.com", displayName: "Luca Verdi" },
];

// imdbId, contentType, note — keyed by friend email.
const SUGGESTIONS: Record<
  string,
  { imdbId: string; contentType: "movie" | "series"; note: string }[]
> = {
  "alice@example.com": [
    { imdbId: "tt1375666", contentType: "movie", note: "Mind-bending — watch it twice." },
    { imdbId: "tt0816692", contentType: "movie", note: "Beautiful and devastating." },
    { imdbId: "tt0903747", contentType: "series", note: "The best ever, no debate." },
  ],
  "marco@example.com": [
    { imdbId: "tt0133093", contentType: "movie", note: "A classic you must revisit." },
    { imdbId: "tt6751668", contentType: "movie", note: "Won Best Picture for a reason." },
    { imdbId: "tt5753856", contentType: "series", note: "If you liked Stranger Things." },
  ],
  "sofia@example.com": [
    { imdbId: "tt0245429", contentType: "movie", note: "Studio Ghibli magic." },
    { imdbId: "tt0468569", contentType: "movie", note: "Heath Ledger is unreal." },
    { imdbId: "tt4574334", contentType: "series", note: "Perfect weekend binge." },
  ],
  "luca@example.com": [
    { imdbId: "tt0137523", contentType: "movie", note: "First rule: you watch it." },
    { imdbId: "tt0944947", contentType: "series", note: "Ignore the last season." },
    { imdbId: "tt7366338", contentType: "series", note: "Tense and gripping." },
  ],
};

async function upsertUser(email: string, displayName: string | null) {
  return prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: { displayName: displayName ?? undefined },
    create: { email: email.toLowerCase(), displayName, addonToken: generateToken() },
  });
}

async function main() {
  const me = await upsertUser(RECIPIENT_EMAIL, null);
  console.log(`Recipient: ${me.email} (id ${me.id})`);
  console.log(`Addon URL: /u/${me.addonToken}/manifest.json`);

  let friendsCreated = 0;
  let suggestionsCreated = 0;

  for (const f of FRIENDS) {
    const friend = await upsertUser(f.email, f.displayName);
    friendsCreated++;

    // Accepted friendship: friend (requester) -> me (addressee).
    await prisma.friendship.upsert({
      where: { requesterId_addresseeId: { requesterId: friend.id, addresseeId: me.id } },
      update: { status: "accepted", respondedAt: new Date() },
      create: {
        requesterId: friend.id,
        addresseeId: me.id,
        status: "accepted",
        respondedAt: new Date(),
      },
    });

    // Their recommendations to me.
    const result = await prisma.suggestion.createMany({
      data: SUGGESTIONS[f.email].map((s) => ({
        fromUserId: friend.id,
        toUserId: me.id,
        imdbId: s.imdbId,
        contentType: s.contentType,
        note: s.note,
      })),
      skipDuplicates: true,
    });
    suggestionsCreated += result.count;
    console.log(`  ${f.displayName}: friendship accepted, +${result.count} suggestion(s)`);
  }

  const totalReceived = await prisma.suggestion.count({ where: { toUserId: me.id } });
  console.log(
    `\nDone. ${friendsCreated} friends, ${suggestionsCreated} new suggestions ` +
      `(${totalReceived} total received by ${me.email}).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
