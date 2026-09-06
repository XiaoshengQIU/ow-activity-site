"use client";
import { useState } from "react";
import Link from "next/link";
import { Button, Notice } from "@/components/ui";
import {
  moreCommitsAvailable,
  type UpdateCheck,
  type UpdateCommit,
} from "@/lib/updates/shared";

export function UpdateDetails({
  result,
  onOpenSettings,
}: {
  result: UpdateCheck;
  onOpenSettings?: () => void;
}) {
  const [commits, setCommits] = useState(result.commits);
  // 页码必须自己记。此前用 commits.length 反推，一旦某页不足 100 条
  // （比较超过 250 条提交时必然发生），下一次会重复请求同一页：
  // 提交被追加两遍、key 重复，按钮也再不会消失。
  const [page, setPage] = useState(1);
  const [lastBatch, setLastBatch] = useState(result.commits.length);
  const [loading, setLoading] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  async function loadMore() {
    setLoading(true);
    setMessage("");
    try {
      const next = page + 1;
      const params = new URLSearchParams({
        sha: result.latestSha,
        revision: String(result.revision),
        page: String(next),
      });
      const response = await fetch(`/api/admin/updates?${params}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      const batch: UpdateCommit[] = data.commits ?? [];
      setPage(next);
      setLastBatch(batch.length);
      if (batch.length) setCommits((current) => [...current, ...batch]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载失败，请重试。");
    } finally {
      setLoading(false);
    }
  }
  async function deploy() {
    setDeploying(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sha: result.latestSha,
          revision: result.revision,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      setSent(true);
      setConfirming(false);
      setMessage(data.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "提交失败，请重试。");
    } finally {
      setDeploying(false);
    }
  }
  return (
    <div className="grid min-w-0 gap-4">
      <p className="break-all text-sm text-muted">
        {result.repositoryUrl.replace("https://github.com/", "")} ·{" "}
        {result.branch || "默认分支"}
      </p>
      <p className="text-sm">
        当前版本 <code>{result.currentSha.slice(0, 7) || "未识别"}</code>
        {result.latestSha ? (
          <>
            {" "}
            → 最新版本 <code>{result.latestSha.slice(0, 7)}</code>
          </>
        ) : null}
      </p>
      <p className="text-sm leading-6">{result.message}</p>
      {commits.length ? (
        <>
          <p className="text-xs text-muted">
            自当前部署以来的提交（{commits.length} / {result.total}）
          </p>
          <ol
            className="max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border px-4"
            aria-label="新版本提交记录"
          >
            {commits.map((commit) => (
              <li key={commit.sha} className="py-3 text-sm leading-6">
                <a
                  href={commit.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 hover:text-accent"
                >
                  <code className="shrink-0 text-xs text-muted">
                    {commit.sha.slice(0, 7)}
                  </code>
                  <span className="min-w-0 break-words">{commit.title}</span>
                </a>
              </li>
            ))}
          </ol>
          {moreCommitsAvailable({
            loaded: commits.length,
            total: result.total,
            lastBatch,
          }) ? (
            <Button
              variant="ghost"
              size="sm"
              isPending={loading}
              onPress={loadMore}
            >
              加载更多提交
            </Button>
          ) : null}
        </>
      ) : null}
      {result.compareUrl ? (
        <a
          href={result.compareUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-accent underline underline-offset-4"
        >
          在 GitHub 查看完整改动
        </a>
      ) : null}
      {result.requestedAt && !sent ? (
        <Notice>
          近期已提交过部署请求，请到 Vercel 查看进度；10 分钟内不会重复触发。
        </Notice>
      ) : null}
      {result.missedSha && !sent ? (
        <Notice tone="warning">
          上次请求部署的是 <code>{result.missedSha.slice(0, 7)}</code>，但站点现在
          仍停在 <code>{result.currentSha.slice(0, 7)}</code>。如果 Vercel 那边已经
          构建完成，请确认 Deploy Hook 绑定的分支就是这里监测的分支。
        </Notice>
      ) : null}
      {result.status === "available" &&
      !result.canDeploy &&
      !result.requestedAt ? (
        <p className="text-sm text-muted">
          配置{" "}
          <Link
            href="/admin/updates"
            onClick={onOpenSettings}
            className="text-accent underline"
          >
            Deploy Hook
          </Link>{" "}
          后可在这里更新。
        </p>
      ) : null}
      {message ? (
        <Notice tone={sent ? "success" : "warning"}>{message}</Notice>
      ) : null}
      {result.canDeploy && !sent ? (
        confirming ? (
          <div className="grid gap-3 rounded-xl bg-default p-4">
            <p className="text-sm leading-6">
              确认触发本站的 Vercel 生产部署？请确保 Deploy Hook
              对应的分支已包含上述改动。部署成功后网站会切换到新版本。
            </p>
            <div className="flex flex-wrap gap-2">
              <Button isPending={deploying} onPress={deploy}>
                确认更新
              </Button>
              <Button
                variant="secondary"
                isDisabled={deploying}
                onPress={() => setConfirming(false)}
              >
                取消
              </Button>
            </div>
          </div>
        ) : (
          <Button className="w-fit" onPress={() => setConfirming(true)}>
            更新网站
          </Button>
        )
      ) : null}
    </div>
  );
}
