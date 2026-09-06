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
};
export type UpdateSettingsView = {
  repositoryUrl: string;
  branch: string;
  revision: number;
  hasDeployHook: boolean;
};
export class UpdateError extends Error {}
