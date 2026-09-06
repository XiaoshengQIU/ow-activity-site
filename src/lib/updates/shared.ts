export const DEFAULT_REPOSITORY =
  "https://github.com/XiaoshengQIU/ow-activity-site";
export const CHECK_INTERVAL_MS = 5 * 60 * 1000;
export function isUpdateCheckFresh(
  checkedAt: string | Date | null | undefined,
  ttl: number,
  now = Date.now(),
) {
  const timestamp =
    typeof checkedAt === "string"
      ? Date.parse(checkedAt)
      : checkedAt instanceof Date
        ? checkedAt.getTime()
        : Number.NaN;
  return Number.isFinite(timestamp) && now - timestamp < ttl;
}
// GitHub compare 接口每页最多 100 条，整个比较最多只返回 250 条提交。
export const UPDATE_PAGE_SIZE = 100;
/**
 * 是否还有下一页提交。必须看上一页拿回多少条，不能只比 loaded < total：
 * 比较超过 250 条时 GitHub 会给出不足一页的结果，此时 loaded 永远追不上
 * total，只看数量会让「加载更多」按钮一直留在页面上。
 */
export function moreCommitsAvailable(input: {
  loaded: number;
  total: number;
  lastBatch: number;
}) {
  return input.lastBatch >= UPDATE_PAGE_SIZE && input.loaded < input.total;
}
export type UpdateCommit = {
  sha: string;
  title: string;
  author: string;
  date: string;
  url: string;
};
export type UpdateCheck = {
  status:
    "current" | "available" | "diverged" | "unknown" | "error" | "checking";
  message: string;
  repositoryUrl: string;
  branch: string;
  revision: number;
  currentSha: string;
  latestSha: string;
  total: number;
  commits: UpdateCommit[];
  compareUrl: string;
  checkedAt: string;
  canDeploy: boolean;
  requestedAt: string | null;
  /** 上次请求部署的目标提交，且站点至今没到那个版本。 */
  missedSha: string | null;
};
/**
 * 上一次部署请求有没有把站点带到目标提交。
 *
 * 监测的分支和 Deploy Hook 实际部署的分支是两件事，代码无从校验（Hook 的
 * URL 和响应都不带仓库分支信息）。配错时的表现是：请求成功、站点版本不变、
 * 更新提示反复出现，管理员看不出原因。这里用已经记下的目标提交回头核对一次。
 * 冷却期内不判断，那时部署多半还在构建。
 */
export function missedDeploySha(input: {
  status: UpdateCheck["status"];
  currentSha: string;
  requestedSha: string | null;
  pending: boolean;
}): string | null {
  if (input.pending || input.status !== "available" || !input.requestedSha)
    return null;
  return input.requestedSha === input.currentSha ? null : input.requestedSha;
}
export type UpdateSettingsView = {
  repositoryUrl: string;
  branch: string;
  revision: number;
  hasDeployHook: boolean;
};
export class UpdateError extends Error {}
