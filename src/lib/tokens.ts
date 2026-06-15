import { randomBytes } from "crypto";

/** Random URL-safe token (default 24 bytes -> ~192 bits of entropy). */
export function generateToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}
