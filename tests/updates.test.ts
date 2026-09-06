import test from "node:test";
import assert from "node:assert/strict";
import {
  compareCommits,
  getRepositoryHead,
  parseRepository,
  parseBranch,
} from "../src/lib/updates/github";
import { parseDeployHook } from "../src/lib/updates/service";
import { CHECK_INTERVAL_MS, isUpdateCheckFresh } from "../src/lib/updates/shared";

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
    if (requests.length === 2) return Response.json({ sha: head });
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
  });
  assert.ok(requests[1].endsWith("/commits/release%2Fstable"));
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
