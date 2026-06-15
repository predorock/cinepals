import { createApp } from "./app";
import { config } from "./config";
import { prisma } from "./db";

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`🎬 Cinepals listening on ${config.publicUrl} (port ${config.port})`);
  console.log(`   Configuration page: ${config.publicUrl}/configure`);
});

// Clean shutdown.
async function shutdown(signal: string) {
  console.log(`\n${signal} received, shutting down...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
