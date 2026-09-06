import { randomUUID } from "node:crypto";
import {
  Prisma,
  type PrismaClient,
  type UpdateSettings,
} from "../../generated/prisma/client";
import { seal, unseal, hasEncryptionKey } from "../oauth/security";
import {
  compareCommits,
  getRepositoryHead,
  parseBranch,
  parseRepository,
  shaSchema,
} from "./github";
import {
  CHECK_INTERVAL_MS,
  UpdateError,
  isUpdateCheckFresh,
  missedDeploySha,
  type UpdateCheck,
  type UpdateSettingsView,
} from "./shared";

const id = "global";
const hookContext = "site-update:vercel-deploy-hook";
const DEPLOY_COOLDOWN = 10 * 60 * 1000;
export function parseDeployHook(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new UpdateError("Deploy Hook 链接不正确。");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.vercel.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !/^\/v1\/integrations\/deploy\/prj_[A-Za-z0-9]+\/[A-Za-z0-9_-]+$/.test(
      url.pathname,
    )
  )
    throw new UpdateError("请填写 Vercel 生成的完整 Deploy Hook 链接。");
  return url.href;
}
export async function getUpdateSettings(db: PrismaClient) {
  const existing = await db.updateSettings.findUnique({ where: { id } });
  if (existing) return existing;
  try {
    return await db.updateSettings.create({ data: { id } });
  } catch {
    const raced = await db.updateSettings.findUnique({ where: { id } });
    if (raced) return raced;
    throw new UpdateError("无法读取版本更新设置。");
  }
}
export function settingsView(row: UpdateSettings): UpdateSettingsView {
  return {
    repositoryUrl: row.repositoryUrl,
    branch: row.branch,
    revision: row.revision,
    hasDeployHook: Boolean(row.encryptedDeployHook),
  };
}
export async function saveUpdateSettings(
  db: PrismaClient,
  input: UpdateSettingsView & { deployHook: string; clearDeployHook: boolean },
  adminId: string,
  key: string | undefined,
) {
  const repositoryUrl = parseRepository(input.repositoryUrl).url;
  const branch = parseBranch(input.branch);
  const row = await getUpdateSettings(db);
  if (row.revision !== input.revision)
    throw new UpdateError("设置已被其他管理员修改，请刷新后重试。");
  const sourceChanged =
    repositoryUrl !== row.repositoryUrl || branch !== row.branch;
  let encryptedDeployHook =
    sourceChanged || input.clearDeployHook ? null : row.encryptedDeployHook;
  if (input.deployHook.trim()) {
    if (input.clearDeployHook)
      throw new UpdateError("请勿同时填写和清除 Deploy Hook。");
    if (!hasEncryptionKey(key))
      throw new UpdateError("服务器尚未配置密钥加密功能。");
    encryptedDeployHook = seal(
      parseDeployHook(input.deployHook),
      hookContext,
      key,
    );
  }
  const saved = await db.updateSettings.updateMany({
    where: { id, revision: input.revision },
    data: {
      repositoryUrl,
      branch,
      encryptedDeployHook,
      revision: { increment: 1 },
      updatedById: adminId,
      checkKey: null,
      checkResult: Prisma.DbNull,
      checkedAt: null,
      checkLease: null,
      checkLeaseUntil: null,
      // 换了来源，旧的部署目标不再有参考意义；冷却时间保留，继续挡住重复触发。
      ...(sourceChanged ? { deployRequestedSha: null } : {}),
    },
  });
  if (saved.count !== 1) throw new UpdateError("设置已变化，请刷新后重试。");
  return {
    repositoryUrl,
    branch,
    revision: input.revision + 1,
    hasDeployHook: Boolean(encryptedDeployHook),
  };
}
function readDeployHook(row: UpdateSettings, key: string | undefined) {
  try {
    return row.encryptedDeployHook
      ? parseDeployHook(unseal(row.encryptedDeployHook, hookContext, key))
      : null;
  } catch {
    return null;
  }
}
function checkKey(row: UpdateSettings, currentSha: string) {
  return `${row.revision}:${row.repositoryUrl}:${row.branch}:${currentSha}`;
}
function emptyCheck(row: UpdateSettings, currentSha: string): UpdateCheck {
  return {
    status: "checking",
    message: "正在检查 GitHub 更新…",
    repositoryUrl: row.repositoryUrl,
    branch: row.branch,
    revision: row.revision,
    currentSha,
    latestSha: "",
    total: 0,
    commits: [],
    compareUrl: "",
    checkedAt: new Date().toISOString(),
    canDeploy: false,
    requestedAt: null,
    missedSha: null,
  };
}
function withDeployment(
  result: UpdateCheck,
  row: UpdateSettings,
  key: string | undefined,
): UpdateCheck {
  const pending = Boolean(
    row.deployRequestedAt &&
    Date.now() - row.deployRequestedAt.getTime() < DEPLOY_COOLDOWN,
  );
  return {
    ...result,
    canDeploy:
      result.status === "available" &&
      Boolean(readDeployHook(row, key)) &&
      !pending,
    requestedAt: pending ? row.deployRequestedAt!.toISOString() : null,
    missedSha: missedDeploySha({
      status: result.status,
      currentSha: result.currentSha,
      requestedSha: row.deployRequestedSha,
      pending,
    }),
  };
}
function freshCachedCheck(
  row: UpdateSettings,
  currentSha: string,
  force: boolean,
) {
  const cached =
    row.checkKey === checkKey(row, currentSha) && row.checkResult
      ? (row.checkResult as unknown as UpdateCheck)
      : null;
  const ttl = force
    ? 15_000
    : cached?.status === "error"
      ? 60_000
      : CHECK_INTERVAL_MS;
  // Prefer the ISO timestamp in the payload. Some adapters shift DateTime columns.
  if (
    cached &&
    (isUpdateCheckFresh(cached.checkedAt, ttl) ||
      isUpdateCheckFresh(row.checkedAt, ttl))
  )
    return cached;
  return null;
}
export async function checkForUpdates(
  db: PrismaClient,
  currentSha: string,
  key: string | undefined,
  force = false,
  fetcher: typeof fetch = fetch,
): Promise<UpdateCheck> {
  const row = await getUpdateSettings(db);
  const cached = freshCachedCheck(row, currentSha, force);
  if (cached) return withDeployment(cached, row, key);
  const result = emptyCheck(row, currentSha);
  if (!shaSchema.safeParse(currentSha).success)
    return {
      ...result,
      status: "unknown",
      message:
        "当前部署缺少版本标识，无法准确列出更新；请在构建时提供 APP_GIT_COMMIT_SHA。",
    };
  const lease = randomUUID();
  const acquired = await db.updateSettings.updateMany({
    where: {
      id,
      revision: row.revision,
      OR: [{ checkLeaseUntil: null }, { checkLeaseUntil: { lt: new Date() } }],
    },
    data: { checkLease: lease, checkLeaseUntil: new Date(Date.now() + 45_000) },
  });
  if (!acquired.count) {
    const latest = await getUpdateSettings(db);
    const nowCached = freshCachedCheck(latest, currentSha, force);
    return nowCached
      ? withDeployment(nowCached, latest, key)
      : { ...result, status: "checking" };
  }
  const afterLease = await getUpdateSettings(db);
  const raced = freshCachedCheck(afterLease, currentSha, force);
  if (raced) {
    await db.updateSettings.updateMany({
      where: { id, checkLease: lease },
      data: { checkLease: null, checkLeaseUntil: null },
    });
    return withDeployment(raced, afterLease, key);
  }
  try {
    const head = await getRepositoryHead(
      row.repositoryUrl,
      row.branch,
      fetcher,
    );
    result.branch = head.branch;
    result.latestSha = head.sha;
    if (head.sha === currentSha) {
      result.status = "current";
      result.message = "当前已是最新版本。";
    } else {
      const comparison = await compareCommits(
        row.repositoryUrl,
        currentSha,
        head.sha,
        1,
        fetcher,
      );
      Object.assign(result, comparison);
      if (comparison.status === "ahead" && comparison.total > 0) {
        result.status = "available";
        result.message = `发现 ${comparison.total} 条新提交，是否更新？`;
      } else if (comparison.status === "diverged") {
        result.status = "diverged";
        result.message = "本站与监测分支均有独立提交，请先合并代码后再部署。";
      } else {
        result.status = "current";
        result.message =
          comparison.status === "behind"
            ? "本站已包含监测分支的全部提交。"
            : "当前已是最新版本。";
      }
    }
  } catch (error) {
    result.status = "error";
    result.message =
      error instanceof UpdateError
        ? error.message
        : "版本检查失败，请稍后重试。";
  }
  result.checkedAt = new Date().toISOString();
  const saved = await db.updateSettings.updateMany({
    where: { id, revision: row.revision, checkLease: lease },
    data: {
      checkKey: checkKey(row, currentSha),
      checkResult: result as unknown as Prisma.InputJsonValue,
      checkedAt: new Date(),
      checkLease: null,
      checkLeaseUntil: null,
    },
  });
  if (!saved.count)
    return {
      ...emptyCheck(row, currentSha),
      message: "设置已变化，正在等待重新检查。",
    };
  return withDeployment(result, row, key);
}
export async function loadUpdateCommits(
  db: PrismaClient,
  currentSha: string,
  latestSha: string,
  revision: number,
  page: number,
  fetcher: typeof fetch = fetch,
) {
  const row = await getUpdateSettings(db);
  const result = row.checkResult as unknown as UpdateCheck | null;
  if (
    row.revision !== revision ||
    row.checkKey !== checkKey(row, currentSha) ||
    result?.latestSha !== latestSha ||
    !["available", "diverged"].includes(result.status)
  )
    throw new UpdateError("版本信息已变化，请重新检查。");
  if (
    !Number.isSafeInteger(page) ||
    page < 2 ||
    page > Math.ceil(result.total / 100)
  )
    throw new UpdateError("提交列表页码不正确。");
  return (
    await compareCommits(
      row.repositoryUrl,
      currentSha,
      latestSha,
      page,
      fetcher,
    )
  ).commits;
}
export async function requestDeployment(
  db: PrismaClient,
  currentSha: string,
  expectedSha: string,
  expectedRevision: number,
  key: string | undefined,
  fetcher: typeof fetch = fetch,
) {
  shaSchema.parse(expectedSha);
  const row = await getUpdateSettings(db);
  const result = row.checkResult as unknown as UpdateCheck | null;
  if (
    row.revision !== expectedRevision ||
    row.checkKey !== checkKey(row, currentSha) ||
    result?.status !== "available" ||
    result.latestSha !== expectedSha
  )
    throw new UpdateError("版本或设置已变化，请重新检查更新。");
  const hook = readDeployHook(row, key);
  if (!hook) throw new UpdateError("请先在后台配置有效的 Vercel Deploy Hook。");
  // 在提交部署前复查分支，避免用过期的改动列表请求更新。
  const latest = await getRepositoryHead(
    row.repositoryUrl,
    row.branch,
    fetcher,
  );
  if (latest.sha !== expectedSha)
    throw new UpdateError("GitHub 又有新提交，请重新检查并查看改动后再更新。");
  const now = new Date();
  const claimed = await db.updateSettings.updateMany({
    where: {
      id,
      revision: expectedRevision,
      OR: [
        { deployRequestedAt: null },
        {
          deployRequestedAt: { lt: new Date(now.getTime() - DEPLOY_COOLDOWN) },
        },
      ],
    },
    data: {
      deployRequestedAt: now,
      deployRequestedSha: expectedSha,
      deployJobId: null,
    },
  });
  if (!claimed.count)
    throw new UpdateError(
      "近期已提交部署请求，请先到 Vercel 查看进度，10 分钟后可重试。",
    );
  let response: Response;
  try {
    response = await fetcher(hook, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new UpdateError(
      "未收到 Vercel 确认，部署可能已受理。请先到 Vercel 查看，10 分钟后可重试。",
    );
  }
  if (!response.ok) {
    await db.updateSettings.updateMany({
      where: { id, deployRequestedAt: now },
      data: { deployRequestedAt: null, deployRequestedSha: null },
    });
    throw new UpdateError(
      "Vercel 拒绝了部署请求，请检查 Deploy Hook 是否有效。",
    );
  }
  const body = await response.json().catch(() => null);
  const jobId = body?.job?.id;
  const state = body?.job?.state;
  if (
    !jobId ||
    (state != null &&
      !["PENDING", "RUNNING", "QUEUED", "READY"].includes(state))
  )
    throw new UpdateError(
      "Vercel 返回的部署状态不明确，请到 Vercel 确认进度。",
    );
  await db.updateSettings.updateMany({
    where: { id, deployRequestedAt: now },
    data: { deployJobId: String(body.job.id).slice(0, 200) },
  });
  return {
    message:
      "部署请求已提交。请到 Vercel 查看进度；部署成功后刷新本站，版本提示会自动更新。",
  };
}
