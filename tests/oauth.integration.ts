import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  consumeOAuthState,
  finishOAuthAccount,
  OAuthError,
  unlinkOAuthAccount,
} from "../src/lib/oauth/accounts";
import {
  oauthAvailability,
  saveOAuthConfig,
  OAuthConfigError,
  runtimeConfig,
} from "../src/lib/oauth/config";
import { hashToken, randomToken } from "../src/lib/oauth/security";

const connectionString = process.env.OAUTH_TEST_DATABASE_URL;
if (!connectionString)
  throw new Error(
    "请设置 OAUTH_TEST_DATABASE_URL；测试只操作独立临时 schema。",
  );
const key = randomBytes(32).toString("hex");

async function withDatabase(run: (db: PrismaClient) => Promise<void>) {
  const schema = "oauth_test_" + randomUUID().replaceAll("-", "");
  assert.match(schema, /^oauth_test_[a-f0-9]{32}$/);
  const client = new Client({ connectionString });
  await client.connect();
  let db: PrismaClient | undefined;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    for (const name of (await readdir("prisma/migrations"))
      .filter((name) => /^\d/.test(name))
      .sort()) {
      const sql = (
        await readFile(`prisma/migrations/${name}/migration.sql`, "utf8")
      ).replace('CREATE SCHEMA IF NOT EXISTS "public";', "");
      await client.query(sql);
    }
    db = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString, max: 4, options: `-c search_path=${schema}` },
        { schema },
      ),
    });
    await run(db);
  } finally {
    await db?.$disconnect();
    try {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await client.end();
    }
  }
}
const config = {
  provider: "google" as const,
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  enabled: true,
  clearSecret: false,
  revision: 0,
};
const identity = {
  accountId: "subject-1",
  email: "same@example.com",
  name: "第三方玩家",
  avatarUrl: "https://example.com/avatar.png",
};

test("后台配置必须完整才能启用，密钥加密保存并支持保留、清除及版本冲突保护", async () => {
  await withDatabase(async (db) => {
    assert.deepEqual(await oauthAvailability(db, key), [
      { provider: "google", available: false },
      { provider: "github", available: false },
    ]);
    await assert.rejects(
      saveOAuthConfig(db, { ...config, clientSecret: "" }, "admin", key),
      OAuthConfigError,
    );
    await saveOAuthConfig(db, config, "admin", key);
    const saved = await db.oAuthConfig.findUniqueOrThrow({
      where: { provider: "google" },
    });
    assert.notEqual(saved.encryptedSecret, config.clientSecret);
    assert.equal(runtimeConfig(saved, key)?.clientSecret, config.clientSecret);
    assert.equal((await oauthAvailability(db, key))[0].available, true);
    await assert.rejects(
      saveOAuthConfig(db, config, "admin", key),
      OAuthConfigError,
    );
    await assert.rejects(
      saveOAuthConfig(
        db,
        { ...config, revision: 1, clientId: "other-id", clientSecret: "" },
        "admin",
        key,
      ),
      OAuthConfigError,
    );
    await saveOAuthConfig(
      db,
      { ...config, revision: 1, clientSecret: "", enabled: false },
      "admin",
      key,
    );
    const disabled = await db.oAuthConfig.findUniqueOrThrow({
      where: { provider: "google" },
    });
    assert.equal(disabled.encryptedSecret, saved.encryptedSecret);
    assert.equal((await oauthAvailability(db, key))[0].available, false);
    await saveOAuthConfig(
      db,
      {
        ...config,
        revision: 2,
        clientSecret: "",
        enabled: false,
        clearSecret: true,
      },
      "admin",
      key,
    );
    assert.equal(
      (
        await db.oAuthConfig.findUniqueOrThrow({
          where: { provider: "google" },
        })
      ).encryptedSecret,
      null,
    );
  });
});

test("OAuth 并发首次登录不重复建号，新账号仍待审核，邮箱相同不自动合并", async () => {
  await withDatabase(async (db) => {
    await saveOAuthConfig(db, config, "admin", key);
    await saveOAuthConfig(db, { ...config, provider: "github" }, "admin", key);
    const results = await Promise.all([
      finishOAuthAccount(db, "google", 1, identity),
      finishOAuthAccount(db, "google", 1, identity),
    ]);
    assert.equal(results[0].user.id, results[1].user.id);
    assert.equal(results.filter((result) => result.created).length, 1);
    const user = await db.user.findUniqueOrThrow({
      where: { id: results[0].user.id },
      include: { profile: true },
    });
    assert.equal(user.role, "USER");
    assert.equal(user.status, "PENDING");
    assert.equal(user.passwordHash, null);
    assert.equal(user.profile?.reviewStatus, "PENDING");
    const other = await finishOAuthAccount(db, "github", 1, identity);
    assert.notEqual(other.user.id, user.id);
    const changedName = await finishOAuthAccount(db, "google", 1, {
      ...identity,
      name: "改名后的用户",
      email: "newer@example.com",
    });
    assert.equal(changedName.user.id, user.id);
    assert.equal(
      (await db.profile.findUniqueOrThrow({ where: { userId: user.id } }))
        .displayName,
      identity.name,
    );
    assert.equal(
      (
        await db.oAuthAccount.findUniqueOrThrow({
          where: {
            provider_providerAccountId: {
              provider: "google",
              providerAccountId: identity.accountId,
            },
          },
        })
      ).email,
      "newer@example.com",
    );
    await db.user.update({
      where: { id: user.id },
      data: { status: "BANNED" },
    });
    await assert.rejects(
      finishOAuthAccount(db, "google", 1, identity),
      (error: unknown) =>
        error instanceof OAuthError && error.code === "banned",
    );
  });
});

test("主动绑定保留管理员权限，冲突绑定与过期配置被拒绝", async () => {
  await withDatabase(async (db) => {
    await saveOAuthConfig(db, config, "admin", key);
    const admin = await db.user.create({
      data: {
        username: "owner",
        passwordHash: "unchanged",
        role: "ADMIN",
        status: "APPROVED",
      },
    });
    const other = await db.user.create({
      data: { username: "other", passwordHash: "unchanged" },
    });
    await finishOAuthAccount(db, "google", 1, identity, admin.id);
    const login = await finishOAuthAccount(db, "google", 1, identity);
    assert.equal(login.user.id, admin.id);
    assert.equal(login.user.role, "ADMIN");
    await assert.rejects(
      finishOAuthAccount(db, "google", 1, identity, other.id),
      (error: unknown) =>
        error instanceof OAuthError && error.code === "conflict",
    );
    await assert.rejects(
      finishOAuthAccount(
        db,
        "google",
        1,
        { ...identity, accountId: "second" },
        admin.id,
      ),
      OAuthError,
    );
    await saveOAuthConfig(
      db,
      { ...config, revision: 1, clientSecret: "", enabled: false },
      "admin",
      key,
    );
    await assert.rejects(
      finishOAuthAccount(db, "google", 1, identity),
      (error: unknown) =>
        error instanceof OAuthError && error.code === "disabled",
    );
    await saveOAuthConfig(
      db,
      { ...config, revision: 2, clientSecret: "", enabled: true },
      "admin",
      key,
    );
    await assert.rejects(
      finishOAuthAccount(db, "google", 1, identity),
      OAuthError,
    );
    assert.equal(
      (await db.user.findUniqueOrThrow({ where: { id: admin.id } }))
        .passwordHash,
      "unchanged",
    );
  });
});

test("OAuth state 只能消费一次，并发回调与过期请求不能复用", async () => {
  await withDatabase(async (db) => {
    const state = randomToken();
    const flow = {
      provider: "google" as const,
      state,
      verifier: randomToken(),
      nonce: randomToken(),
      expiresAt: Date.now() + 60_000,
      revision: 1,
      callbackUrl: "https://site.example/callback",
      linkUserId: null,
      linkSessionHash: null,
    };
    await db.oAuthState.create({
      data: {
        provider: "google",
        stateHash: hashToken(state),
        expiresAt: new Date(flow.expiresAt),
      },
    });
    const results = await Promise.allSettled([
      consumeOAuthState(db, flow),
      consumeOAuthState(db, flow),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    await assert.rejects(consumeOAuthState(db, flow), OAuthError);
    await db.oAuthState.create({
      data: {
        provider: "google",
        stateHash: hashToken(state),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await assert.rejects(consumeOAuthState(db, flow), OAuthError);
  });
});

test("解绑须保留最后一种登录方式，解绑后原平台账号可以绑到别人", async () => {
  await withDatabase(async (db) => {
    await saveOAuthConfig(db, config, "admin", key);
    await saveOAuthConfig(db, { ...config, provider: "github" }, "admin", key);
    const created = await finishOAuthAccount(db, "google", 1, identity);
    await assert.rejects(
      unlinkOAuthAccount(db, created.user.id, "google"),
      (error: unknown) => error instanceof OAuthError && error.code === "last",
    );
    await db.user.update({
      where: { id: created.user.id },
      data: { passwordHash: "set" },
    });
    await unlinkOAuthAccount(db, created.user.id, "google");
    assert.equal(
      await db.oAuthAccount.count({ where: { userId: created.user.id } }),
      0,
    );
    const other = await db.user.create({
      data: { username: "other", passwordHash: "other" },
    });
    assert.equal(
      (await finishOAuthAccount(db, "google", 1, identity, other.id)).user.id,
      other.id,
    );
    await finishOAuthAccount(
      db,
      "github",
      1,
      { ...identity, accountId: "gh-1", email: "gh@example.com" },
      other.id,
    );
    await db.user.update({
      where: { id: other.id },
      data: { passwordHash: null },
    });
    await unlinkOAuthAccount(db, other.id, "google");
    await assert.rejects(
      unlinkOAuthAccount(db, other.id, "github"),
      (error: unknown) => error instanceof OAuthError && error.code === "last",
    );
    await assert.rejects(
      unlinkOAuthAccount(db, other.id, "google"),
      (error: unknown) =>
        error instanceof OAuthError && error.code === "missing",
    );
  });
});
