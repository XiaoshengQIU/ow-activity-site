import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import type { OAuthProvider } from "./shared";

export const OAUTH_LIFETIME_SECONDS = 600;
export function hasEncryptionKey(key: string | undefined): key is string {
  return Boolean(key && /^[a-f0-9]{64}$/i.test(key));
}
function readKey(key: string | undefined) {
  if (!hasEncryptionKey(key))
    throw new Error("OAuth encryption key unavailable");
  return Buffer.from(key, "hex");
}
export function seal(value: string, context: string, key: string | undefined) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", readKey(key), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    data.toString("base64url"),
  ].join(".");
}
export function unseal(
  value: string,
  context: string,
  key: string | undefined,
) {
  const [version, iv, tag, data, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !data || extra)
    throw new Error("Invalid encrypted value");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    readKey(key),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
export const randomToken = () => randomBytes(32).toString("base64url");
export const hashToken = (value: string) =>
  createHash("sha256").update(value).digest("base64url");
export function sameToken(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const flowSchema = z.object({
  provider: z.enum(["google", "github"]),
  state: token,
  verifier: token,
  nonce: token,
  expiresAt: z.number().int(),
  revision: z.number().int().nonnegative(),
  callbackUrl: z.string().url(),
  linkUserId: z.string().nullable(),
  linkSessionHash: z.string().nullable(),
  entry: z.enum(["login", "register", "link"]).optional(),
});
export type OAuthFlow = z.infer<typeof flowSchema>;
export function readFlow(
  value: string,
  provider: OAuthProvider,
  state: string,
  key: string | undefined,
  now = Date.now(),
) {
  if (value.length > 4096) throw new Error("Invalid OAuth flow");
  const flow = flowSchema.parse(
    JSON.parse(unseal(value, `oauth-flow:${provider}`, key)),
  );
  if (
    flow.provider !== provider ||
    !sameToken(flow.state, state) ||
    flow.expiresAt <= now ||
    flow.expiresAt > now + OAUTH_LIFETIME_SECONDS * 1000
  )
    throw new Error("Invalid OAuth state");
  return flow;
}
