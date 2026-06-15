import path from "path";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";

import { authRouter } from "./routes/authRoutes";
import { friendRouter } from "./routes/friendRoutes";
import { suggestionRouter } from "./routes/suggestionRoutes";
import { searchRouter } from "./routes/searchRoutes";
import { addonRouter } from "./addon/router";
import { config } from "./config";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1); // behind the Render proxy (rate-limit, secure cookie)
  app.use(express.json());
  app.use(cookieParser());

  // Request logger (dev only): see every call Stremio makes to the addon.
  if (!config.isProd) {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on("finish", () => {
        console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
      });
      next();
    });
  }

  // CORS: open on the addon routes (required by Stremio), same-origin on the APIs.
  app.use("/api", cors({ origin: true, credentials: true }));

  // Health check (for Render).
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // REST API (used by the /configure page).
  app.use("/api/auth", authRouter);
  app.use("/api/friends", friendRouter);
  app.use("/api/suggestions", suggestionRouter);
  app.use("/api/search", searchRouter);

  const publicDir = path.join(__dirname, "..", "public");

  // The Stremio manifest is marked configurable, so Stremio points its
  // "Configure" button at <addon-base>/configure, i.e. /u/:token/configure.
  // Serve the SPA there too (it detects the session via cookie on load).
  app.get("/u/:token/configure", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  // Stremio addon: per-user custom URL with the token in the path.
  app.use("/u/:token", addonRouter);

  // Static frontend.
  app.use(express.static(publicDir));

  // The SPA responds on both / and /configure.
  app.get(["/", "/configure"], (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  return app;
}
