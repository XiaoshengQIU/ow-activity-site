import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { ArticleCard } from "@/components/article-card";
import { EmptyState, PageHeading } from "@/components/page-heading";
import { Button, ButtonLink, InputField } from "@/components/ui";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { articleCardSelect } from "@/lib/articles-data";
import { publicArticleWhere } from "@/lib/article-service";
import { demoArticles } from "@/lib/demo-data";

export const metadata: Metadata = { title: "社区文章" };
// 没有数据库时列表页也用演示文章，否则首页有内容、点进来却是空的。
function demoArticleList(q: string) {
  const keyword = q.toLowerCase();
  const matched = keyword
    ? demoArticles.filter((article) =>
        `${article.title} ${article.excerpt}`.toLowerCase().includes(keyword),
      )
    : demoArticles;
  return [matched.length, matched] as const;
}

export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 100) : "";
  const where = {
    ...publicArticleWhere,
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { excerpt: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const requestedPage = Math.max(1, Math.trunc(Number(query.page) || 1));
  const [count, articles] = isDatabaseConfigured()
    ? await Promise.all([
        prisma.article.count({ where }),
        prisma.article.findMany({
          where,
          orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
          skip: (requestedPage - 1) * 12,
          take: 12,
          select: articleCardSelect,
        }),
      ])
    : demoArticleList(q);
  const pages = Math.max(1, Math.ceil(count / 12));
  const page = Math.min(pages, requestedPage);
  return (
    <main className="page-shell">
      <PageHeading title="文章" />
      <form action="/articles" method="get" className="article-search">
        <InputField
          label="搜索文章"
          name="q"
          defaultValue={q}
          key={q}
          placeholder="标题、摘要…"
          maxLength={100}
        />
        <Button type="submit" variant="secondary" aria-label="搜索文章">
          <Search size={17} />
        </Button>
      </form>
      {articles.length ? (
        <div className="article-grid">
          {articles.map((article) => (
            <ArticleCard key={article.id} article={article} />
          ))}
        </div>
      ) : (
        <EmptyState
          title={q ? "没有找到匹配的文章" : "暂无文章"}
          description={q ? "试试其他关键词。" : undefined}
          action={
            q ? (
              <ButtonLink href="/articles" variant="secondary">
                查看全部文章
              </ButtonLink>
            ) : undefined
          }
        />
      )}
      {pages > 1 ? (
        <nav className="article-pagination" aria-label="文章分页">
          {page > 1 ? (
            <Link
              href={`/articles?${new URLSearchParams({ q, page: String(page - 1) })}`}
            >
              上一页
            </Link>
          ) : (
            <span />
          )}
          <span>
            {page} / {pages}
          </span>
          {page < pages ? (
            <Link
              href={`/articles?${new URLSearchParams({ q, page: String(page + 1) })}`}
            >
              下一页
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </main>
  );
}
