import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { OAuthIdentity } from "./providers";
import { hashToken, type OAuthFlow } from "./security";
import { canUnlinkOAuth, type OAuthProvider } from "./shared";
export class OAuthError extends Error {
  constructor(
    public code:
      | "expired"
      | "disabled"
      | "banned"
      | "conflict"
      | "session"
      | "last"
      | "missing",
  ) {
    super(code);
  }
}
export async function consumeOAuthState(db: PrismaClient, flow: OAuthFlow) {
  const consumed = await db.oAuthState.deleteMany({
    where: {
      stateHash: hashToken(flow.state),
      provider: flow.provider,
      expiresAt: { gt: new Date() },
    },
  });
  if (consumed.count !== 1) throw new OAuthError("expired");
}
export async function finishOAuthAccount(
  db: PrismaClient,
  provider: OAuthProvider,
  revision: number,
  identity: OAuthIdentity,
  linkUserId: string | null = null,
) {
  return db.$transaction(async (tx) => {
    // 与后台配置更新共用数据库行锁；停用或更换配置后，旧授权不能继续登录。
    const active = await tx.$queryRaw<
      Array<{ provider: string }>
    >`SELECT "provider" FROM "OAuthConfig" WHERE "provider"::text = ${provider} AND "enabled" = true AND "revision" = ${revision} FOR UPDATE`;
    if (active.length !== 1) throw new OAuthError("disabled");
    const account = await tx.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider,
          providerAccountId: identity.accountId,
        },
      },
      include: { user: true },
    });
    if (account) {
      if (linkUserId && account.userId !== linkUserId)
        throw new OAuthError("conflict");
      if (account.user.status === "BANNED") throw new OAuthError("banned");
      if (account.email !== identity.email) {
        await tx.oAuthAccount.update({
          where: { id: account.id },
          data: { email: identity.email },
        });
      }
      return {
        user: { id: account.user.id, role: account.user.role },
        created: false,
      };
    }
    if (linkUserId) {
      const user = await tx.user.findUnique({ where: { id: linkUserId } });
      if (!user || user.status === "BANNED") throw new OAuthError("session");
      if (
        await tx.oAuthAccount.findUnique({
          where: { userId_provider: { userId: user.id, provider } },
        })
      )
        throw new OAuthError("conflict");
      await tx.oAuthAccount.create({
        data: {
          userId: user.id,
          provider,
          providerAccountId: identity.accountId,
          email: identity.email,
        },
      });
      return { user: { id: user.id, role: user.role }, created: false };
    }
    const name = identity.name.trim().slice(0, 20);
    const user = await tx.user.create({
      data: {
        username: `${provider}_${randomBytes(8).toString("hex")}`,
        passwordHash: null,
        role: "USER",
        status: "PENDING",
        profile: {
          create: {
            displayName: name.length >= 2 ? name : "新玩家",
            avatarUrl: identity.avatarUrl,
            slogan: "刚加入社区，请多关照。",
            reviewStatus: "PENDING",
          },
        },
        oauthAccounts: {
          create: {
            provider,
            providerAccountId: identity.accountId,
            email: identity.email,
          },
        },
      },
      select: { id: true, role: true },
    });
    return { user, created: true };
  });
}

export async function unlinkOAuthAccount(
  db: PrismaClient,
  userId: string,
  provider: OAuthProvider,
) {
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<
      Array<{ passwordHash: string | null; status: string }>
    >`SELECT "passwordHash", "status" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const user = locked[0];
    if (!user || user.status === "BANNED") throw new OAuthError("session");
    const linked = await tx.oAuthAccount.findMany({
      where: { userId },
      select: { provider: true },
    });
    if (!linked.some((item) => item.provider === provider))
      throw new OAuthError("missing");
    if (!canUnlinkOAuth(Boolean(user.passwordHash), linked.length))
      throw new OAuthError("last");
    await tx.oAuthAccount.delete({
      where: { userId_provider: { userId, provider } },
    });
  });
}
