import { z } from "zod";
import { UpdateError, type UpdateCommit } from "./shared";

export function parseRepository(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new UpdateError("请输入完整的 GitHub 仓库链接。");
  }
  const path = url.pathname.replace(/\/$/, "").replace(/\.git$/, "");
  const parts = path.match(/^\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)$/);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !parts ||
    parts[2] === "." ||
    parts[2] === ".."
  )
    throw new UpdateError(
      "仓库链接格式应为 https://github.com/用户名/仓库名。",
    );
  return {
    owner: parts[1],
    name: parts[2],
    url: `https://github.com/${parts[1]}/${parts[2]}`,
    api: `https://api.github.com/repos/${parts[1]}/${parts[2]}`,
  };
}
export function parseBranch(value: string) {
  const branch = value.trim();
  if (
    branch.length > 200 ||
    (branch &&
      (!/^[A-Za-z0-9_./-]+$/.test(branch) ||
        branch.includes("..") ||
        branch.includes("//") ||
        /^[/.\-]/.test(branch) ||
        /[/.]$/.test(branch) ||
        branch.endsWith(".lock")))
  )
    throw new UpdateError("分支名称不正确；留空可监测仓库默认分支。");
  return branch;
}
export const shaSchema = z.string().regex(/^[a-f0-9]{40}$/i);
const commitSchema = z.object({
  sha: shaSchema,
  commit: z.object({
    message: z.string(),
    author: z
      .object({
        name: z.string().nullable().optional(),
        date: z.string().nullable().optional(),
      })
      .nullable(),
  }),
});
const comparisonSchema = z.object({
  status: z.enum(["ahead", "behind", "identical", "diverged"]),
  ahead_by: z.number().int().nonnegative(),
  total_commits: z.number().int().nonnegative(),
  commits: z.array(commitSchema),
});
type Fetcher = typeof fetch;
async function githubJson(url: string, fetcher: Fetcher) {
  let response: Response;
  try {
    response = await fetcher(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ow-activity-site-update-check",
      },
    });
  } catch {
    throw new UpdateError("暂时无法连接 GitHub，请稍后重试。");
  }
  if (response.status === 403 || response.status === 429)
    throw new UpdateError("GitHub 请求次数已达上限，请稍后重试。");
  if (response.status === 404 || response.status === 422)
    throw new UpdateError(
      "无法比较版本：请确认仓库公开、分支存在，且包含本站当前提交的历史。",
    );
  if (!response.ok)
    throw new UpdateError("GitHub 暂时无法完成版本检查，请稍后重试。");
  return response.json();
}
const runsSchema = z.object({
  workflow_runs: z.array(z.object({ head_sha: shaSchema })),
});
/**
 * 分支最新一条提交不一定构建得起来。取最近一次「推送到该分支且成功」的
 * Actions 运行，把它的提交当作比较目标，就只会提示已经通过检查的版本。
 *
 * event=push 不能省：来自 fork 的 Pull Request，其 head_branch 也可能叫
 * main，不过滤会把 fork 上的提交当成本仓库分支的最新版本。
 */
async function latestVerifiedSha(
  api: string,
  branch: string,
  fetcher: Fetcher,
) {
  const query = new URLSearchParams({
    branch,
    status: "success",
    event: "push",
    per_page: "1",
  });
  try {
    const runs = runsSchema.parse(
      await githubJson(`${api}/actions/runs?${query}`, fetcher),
    );
    return runs.workflow_runs[0]?.head_sha ?? "";
  } catch {
    // 仓库没有开 Actions、或返回结构不认识时，退回分支最新提交。
    return "";
  }
}
export async function getRepositoryHead(
  repositoryUrl: string,
  branchInput: string,
  fetcher: Fetcher = fetch,
) {
  const repository = parseRepository(repositoryUrl);
  const metadata = z
    .object({ default_branch: z.string(), private: z.boolean() })
    .parse(await githubJson(repository.api, fetcher));
  if (metadata.private) throw new UpdateError("目前支持监测公开 GitHub 仓库。");
  const branch = parseBranch(branchInput) || metadata.default_branch;
  const verified = await latestVerifiedSha(repository.api, branch, fetcher);
  if (verified) return { branch, sha: verified, verified: true };
  const head = z
    .object({ sha: shaSchema })
    .parse(
      await githubJson(
        `${repository.api}/commits/${encodeURIComponent(branch)}`,
        fetcher,
      ),
    );
  return { branch, sha: head.sha, verified: false };
}
export async function compareCommits(
  repositoryUrl: string,
  base: string,
  head: string,
  page = 1,
  fetcher: Fetcher = fetch,
) {
  const repository = parseRepository(repositoryUrl);
  shaSchema.parse(base);
  shaSchema.parse(head);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000)
    throw new UpdateError("提交列表页码不正确。");
  const comparison = comparisonSchema.parse(
    await githubJson(
      `${repository.api}/compare/${base}...${head}?per_page=100&page=${page}`,
      fetcher,
    ),
  );
  const commits: UpdateCommit[] = comparison.commits.map((item) => ({
    sha: item.sha,
    title: (item.commit.message.split(/\r?\n/)[0] || "（无提交说明）").slice(
      0,
      500,
    ),
    author: (item.commit.author?.name || "未知作者").slice(0, 100),
    date: item.commit.author?.date || "",
    url: `${repository.url}/commit/${item.sha}`,
  }));
  return {
    status: comparison.status,
    total: comparison.total_commits,
    commits,
    compareUrl: `${repository.url}/compare/${base}...${head}`,
  };
}
