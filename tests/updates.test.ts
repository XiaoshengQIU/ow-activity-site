import test from "node:test";
import assert from "node:assert/strict";
import {
  compareCommits,
  getRepositoryHead,
  parseRepository,
  parseBranch,
} from "../src/lib/updates/github";
import { parseDeployHook } from "../src/lib/updates/service";
import {
  CHECK_INTERVAL_MS,
  isUpdateCheckFresh,
  missedDeploySha,
  moreCommitsAvailable,
  UPDATE_PAGE_SIZE,
} from "../src/lib/updates/shared";

const repo = "https://github.com/XiaoshengQIU/ow-activity-site";
const base = "a".repeat(40),
  head = "b".repeat(40);
test("更新仓库与部署 Hook 严格限定官方 HTTPS 地址，拒绝凭据、跳转与任意主机", () => {
  assert.equal(parseRepository(repo + ".git/").url, repo);
  for (const value of [
    "http://github.com/a/b",
    "https://github.com.evil.test/a/b",
    "https://user@github.com/a/b",
    repo + "/tree/main",
    repo + "?token=x",
    "https://127.0.0.1/a/b",
    "https://github.com:123/a/b",
  ])
    assert.throws(() => parseRepository(value));
  assert.equal(parseBranch("release/stable"), "release/stable");
  for (const value of ["a..b", "main?x", "-main", "a.lock"])
    assert.throws(() => parseBranch(value));
  assert.equal(
    parseDeployHook(
      "https://api.vercel.com/v1/integrations/deploy/prj_example/secret",
    ),
    "https://api.vercel.com/v1/integrations/deploy/prj_example/secret",
  );
  for (const value of [
    "http://api.vercel.com/v1/integrations/deploy/prj_example/secret",
    "https://example.com/hook",
    "https://api.vercel.com/v1/projects",
    "https://user:pass@api.vercel.com/v1/integrations/deploy/prj_example/secret",
    "https://api.vercel.com/v1/integrations/deploy/prj_example/secret?next=http://localhost",
  ])
    assert.throws(() => parseDeployHook(value));
});
test("使用默认分支并固定比较两端 SHA，分页列出每条提交的首行", async () => {
  const requests: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    requests.push(String(url));
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    if (requests.length === 1)
      return Response.json({
        default_branch: "release/stable",
        private: false,
      });
    if (requests.length === 2)
      return Response.json({ workflow_runs: [{ head_sha: head }] });
    return Response.json({
      status: "ahead",
      ahead_by: 101,
      total_commits: 101,
      commits: [
        {
          sha: head,
          html_url: "javascript:alert(1)",
          commit: {
            message: "中文提交标题\n\n不展示冗长正文",
            author: { name: "测试", date: "2026-09-05T10:00:00Z" },
          },
        },
      ],
    });
  };
  assert.deepEqual(await getRepositoryHead(repo, "", fetcher), {
    sha: head,
    branch: "release/stable",
    verified: true,
  });
  // 必须带 event=push：来自 fork 的 PR，其 head_branch 也可能叫 main。
  assert.ok(requests[1].includes("/actions/runs?"));
  assert.ok(requests[1].includes("branch=release%2Fstable"));
  assert.ok(requests[1].includes("status=success"));
  assert.ok(requests[1].includes("event=push"));
  const result = await compareCommits(repo, base, head, 2, fetcher);
  assert.equal(result.total, 101);
  assert.equal(result.commits[0].title, "中文提交标题");
  assert.equal(result.commits[0].url, repo + "/commit/" + head);
  assert.ok(requests[2].endsWith(`${base}...${head}?per_page=100&page=2`));
});
test("限流、不存在的仓库和网络失败不伪装成最新版本", async () => {
  for (const status of [403, 429])
    await assert.rejects(
      getRepositoryHead(repo, "", async () => new Response(null, { status })),
      /次数已达上限/,
    );
  await assert.rejects(
    getRepositoryHead(
      repo,
      "",
      async () => new Response(null, { status: 404 }),
    ),
    /无法比较版本/,
  );
  await assert.rejects(
    getRepositoryHead(repo, "", async () => {
      throw new Error("network");
    }),
    /暂时无法连接/,
  );
});
test("版本检查缓存以 ISO 时间为准，不受 DateTime 列时区偏移影响", () => {
  const now = Date.parse("2026-09-06T01:00:00.000Z");
  assert.equal(
    isUpdateCheckFresh("2026-09-06T00:56:00.000Z", CHECK_INTERVAL_MS, now),
    true,
  );
  assert.equal(
    isUpdateCheckFresh("2026-09-06T00:50:00.000Z", CHECK_INTERVAL_MS, now),
    false,
  );
  const shiftedColumn = new Date("2026-09-05T17:56:00.000Z");
  assert.equal(isUpdateCheckFresh(shiftedColumn, CHECK_INTERVAL_MS, now), false);
  assert.equal(isUpdateCheckFresh(null, CHECK_INTERVAL_MS, now), false);
});

test("提交分页在 GitHub 只给回 250 条时收尾，不重复请求同一页", () => {
  // GitHub compare：每页 100 条，且整个比较最多返回 250 条。
  const total = 400;
  const fetchPage = (page: number) => {
    const start = (page - 1) * UPDATE_PAGE_SIZE;
    return Math.max(0, Math.min(UPDATE_PAGE_SIZE, Math.min(total, 250) - start));
  };

  let page = 1;
  let lastBatch = fetchPage(page);
  let loaded = lastBatch;
  const requested = [page];
  while (moreCommitsAvailable({ loaded, total, lastBatch })) {
    page += 1;
    assert.ok(!requested.includes(page), `page ${page} 被重复请求`);
    requested.push(page);
    lastBatch = fetchPage(page);
    loaded += lastBatch;
    assert.ok(requested.length <= 10, "分页没有收敛");
  }

  assert.deepEqual(requested, [1, 2, 3]);
  assert.equal(loaded, 250);
  assert.equal(moreCommitsAvailable({ loaded, total, lastBatch }), false);
});

test("提交数不足一页或刚好取完时都不再显示加载更多", () => {
  assert.equal(
    moreCommitsAvailable({ loaded: 12, total: 12, lastBatch: 12 }),
    false,
  );
  assert.equal(
    moreCommitsAvailable({ loaded: 150, total: 150, lastBatch: 50 }),
    false,
  );
  assert.equal(
    moreCommitsAvailable({ loaded: 100, total: 150, lastBatch: 100 }),
    true,
  );
});

test("部署请求没把站点带到目标提交时才提示，冷却期和已生效的情况都不提示", () => {
  const requested = "c".repeat(40);
  const current = "d".repeat(40);
  const base = {
    status: "available" as const,
    currentSha: current,
    requestedSha: requested,
    pending: false,
  };
  // 冷却期内部署多半还在构建，不下判断。
  assert.equal(missedDeploySha({ ...base, pending: true }), null);
  // 冷却结束仍停在旧版本，说明这次请求没生效。
  assert.equal(missedDeploySha(base), requested);
  // 站点已经到了目标提交。
  assert.equal(
    missedDeploySha({ ...base, currentSha: requested }),
    null,
  );
  // 已是最新或还没检查出结果时都不提示。
  assert.equal(missedDeploySha({ ...base, status: "current" }), null);
  assert.equal(missedDeploySha({ ...base, status: "checking" }), null);
  // 从没请求过部署。
  assert.equal(missedDeploySha({ ...base, requestedSha: null }), null);
});

test("没有可用的 Actions 记录时退回分支最新提交", async () => {
  const requests: string[] = [];
  const fetcher = async (input: RequestInfo | URL) => {
    requests.push(String(input));
    if (requests.length === 1)
      return Response.json({ default_branch: "main", private: false });
    // 仓库没开 Actions，或者这个分支还没有成功的推送构建
    if (requests.length === 2) return Response.json({ workflow_runs: [] });
    return Response.json({ sha: head });
  };
  assert.deepEqual(await getRepositoryHead(repo, "", fetcher), {
    sha: head,
    branch: "main",
    verified: false,
  });
  assert.ok(requests[2].endsWith("/commits/main"));
});

test("Actions 接口报错不影响版本检查，退回分支最新提交", async () => {
  const requests: string[] = [];
  const fetcher = async (input: RequestInfo | URL) => {
    requests.push(String(input));
    if (requests.length === 1)
      return Response.json({ default_branch: "main", private: false });
    if (requests.length === 2) return new Response(null, { status: 500 });
    return Response.json({ sha: head });
  };
  const result = await getRepositoryHead(repo, "", fetcher);
  assert.equal(result.sha, head);
  assert.equal(result.verified, false);
});
