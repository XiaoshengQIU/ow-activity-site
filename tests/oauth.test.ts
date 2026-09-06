import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  authorizationUrl,
  exchangeIdentity,
  githubIdentity,
  verifyGoogleIdentity,
} from "../src/lib/oauth/providers";
import {
  hasEncryptionKey,
  randomToken,
  readFlow,
  seal,
  unseal,
  type OAuthFlow,
} from "../src/lib/oauth/security";
import { runtimeConfig } from "../src/lib/oauth/config";
import {
  canUnlinkOAuth,
  oauthEntryFromIntent,
  oauthReturnPath,
} from "../src/lib/oauth/shared";

const key = randomBytes(32).toString("hex");
const config = {
  provider: "google" as const,
  clientId: "client-id",
  clientSecret: "client-secret",
  revision: 1,
};
const flow = (): OAuthFlow => ({
  provider: "google",
  state: randomToken(),
  verifier: randomToken(),
  nonce: randomToken(),
  expiresAt: Date.now() + 600_000,
  revision: 1,
  callbackUrl: "https://site.example/api/auth/google/callback",
  linkUserId: null,
  linkSessionHash: null,
});

test("OAuth 密钥加密后不可跨平台解密，篡改和错误密钥均被拒绝", () => {
  const value = seal("client-secret", "oauth-config:google", key);
  assert.ok(!value.includes("client-secret"));
  assert.equal(unseal(value, "oauth-config:google", key), "client-secret");
  assert.notEqual(value, seal("client-secret", "oauth-config:google", key));
  assert.throws(() => unseal(value, "oauth-config:github", key));
  assert.throws(() =>
    unseal(value, "oauth-config:google", randomBytes(32).toString("hex")),
  );
  const parts = value.split(".");
  parts[2] = randomBytes(16).toString("base64url");
  assert.throws(() => unseal(parts.join("."), "oauth-config:google", key));
  assert.equal(hasEncryptionKey("short"), false);
});

test("OAuth 状态绑定浏览器 cookie、平台和有效期", () => {
  const pending = flow();
  const encrypted = seal(JSON.stringify(pending), "oauth-flow:google", key);
  assert.deepEqual(readFlow(encrypted, "google", pending.state, key), pending);
  assert.throws(() => readFlow(encrypted, "google", randomToken(), key));
  assert.throws(() => readFlow(encrypted, "github", pending.state, key));
  assert.throws(() =>
    readFlow(encrypted, "google", pending.state, key, pending.expiresAt),
  );
  assert.throws(() => readFlow("", "google", pending.state, key));
  const registering = { ...pending, entry: "register" as const };
  assert.equal(
    readFlow(
      seal(JSON.stringify(registering), "oauth-flow:google", key),
      "google",
      registering.state,
      key,
    ).entry,
    "register",
  );
});

test("绑定与注册失败回到原页面，解绑须留下密码或另一个第三方账号", () => {
  assert.equal(oauthEntryFromIntent("link"), "link");
  assert.equal(oauthEntryFromIntent("register"), "register");
  assert.equal(oauthEntryFromIntent("login"), "login");
  assert.equal(oauthEntryFromIntent(null), "login");
  assert.equal(oauthReturnPath("link"), "/me");
  assert.equal(oauthReturnPath("register"), "/register");
  assert.equal(oauthReturnPath("login"), "/login");
  assert.equal(oauthReturnPath(), "/login");
  assert.equal(canUnlinkOAuth(false, 1), false);
  assert.equal(canUnlinkOAuth(true, 1), true);
  assert.equal(canUnlinkOAuth(false, 2), true);
  assert.equal(canUnlinkOAuth(true, 2), true);
  assert.equal(canUnlinkOAuth(false, 0), false);
});

test("未配置、未启用或密钥无法解密的 OAuth 不可使用", () => {
  const row = {
    ...config,
    encryptedSecret: seal(config.clientSecret, "oauth-config:google", key),
    enabled: true,
    updatedById: null,
    updatedAt: new Date(),
  };
  assert.ok(runtimeConfig(row, key));
  for (const change of [
    { clientId: "" },
    { encryptedSecret: null },
    { enabled: false },
  ])
    assert.equal(runtimeConfig({ ...row, ...change }, key), null);
  assert.equal(runtimeConfig(row, undefined), null);
  assert.equal(runtimeConfig(row, randomBytes(32).toString("hex")), null);
});

test("两平台授权均携带 S256 PKCE 和 state，仅请求基本登录资料", () => {
  for (const provider of ["google", "github"] as const) {
    const pending = { ...flow(), provider };
    const url = authorizationUrl({ ...config, provider }, pending);
    assert.equal(url.protocol, "https:");
    assert.equal(url.searchParams.get("state"), pending.state);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("code_challenge")?.length, 43);
    assert.equal(url.searchParams.has("client_secret"), false);
    assert.equal(
      url.searchParams.get("scope"),
      provider === "google" ? "openid email profile" : "read:user user:email",
    );
    if (provider === "google")
      assert.equal(url.searchParams.get("nonce"), pending.nonce);
  }
});

test("Google ID token 校验签名、受众、发行方、过期时间、nonce 与邮箱验证状态", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const keys = createLocalJWKSet({
    keys: [{ ...(await exportJWK(publicKey)), kid: "test" }],
  });
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: "https://accounts.google.com",
    aud: "client-id",
    sub: "stable-id",
    iat: now,
    exp: now + 300,
    nonce: "nonce",
    email: "player@example.com",
    email_verified: true,
    name: "测试玩家",
  };
  const sign = (changes = {}) =>
    new SignJWT({ ...claims, ...changes })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .sign(privateKey);
  const identity = await verifyGoogleIdentity(
    await sign(),
    "client-id",
    "nonce",
    keys,
  );
  assert.equal(identity.accountId, "stable-id");
  for (const change of [
    { iss: "https://attacker.example" },
    { aud: "wrong-client" },
    { exp: now - 30 },
    { nonce: "wrong" },
    { email_verified: false },
    { azp: "wrong-client" },
    { sub: "" },
  ]) {
    await assert.rejects(
      verifyGoogleIdentity(await sign(change), "client-id", "nonce", keys),
    );
  }
  const other = await generateKeyPair("RS256");
  const forged = await new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .sign(other.privateKey);
  await assert.rejects(
    verifyGoogleIdentity(forged, "client-id", "nonce", keys),
  );
});

test("GitHub 使用稳定用户 ID 和已验证邮箱，不信任未验证邮箱和危险头像", () => {
  const profile = {
    id: 42,
    login: "renamable",
    avatar_url: "javascript:alert(1)",
  };
  const identity = githubIdentity(profile, [
    { email: "unverified@example.com", primary: true, verified: false },
    { email: "verified@example.com", primary: false, verified: true },
  ]);
  assert.equal(identity.accountId, "42");
  assert.equal(identity.email, "verified@example.com");
  assert.equal(identity.avatarUrl, null);
  assert.equal(githubIdentity(profile, []).email, null);
  assert.throws(() => githubIdentity({ ...profile, id: 1.5 }, []));
});

test("GitHub 服务端交换授权码带上 verifier，并通过令牌读取当前用户", async () => {
  const pending = { ...flow(), provider: "github" as const };
  const calls: string[] = [];
  const request: typeof fetch = async (url, init) => {
    calls.push(String(url));
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    if (calls.length === 1) {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("code_verifier"), pending.verifier);
      assert.equal(body.get("redirect_uri"), pending.callbackUrl);
      assert.equal(body.get("client_secret"), config.clientSecret);
      return Response.json({
        access_token: "test-token",
        token_type: "bearer",
      });
    }
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer test-token",
    );
    return Response.json(
      calls.length === 2
        ? { id: 42, login: "player" }
        : [{ email: "player@example.com", primary: true, verified: true }],
    );
  };
  const identity = await exchangeIdentity(
    { ...config, provider: "github" },
    pending,
    "code",
    request,
  );
  assert.equal(identity.accountId, "42");
  assert.deepEqual(calls, [
    "https://github.com/login/oauth/access_token",
    "https://api.github.com/user",
    "https://api.github.com/user/emails",
  ]);
});
