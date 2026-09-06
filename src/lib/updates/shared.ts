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
