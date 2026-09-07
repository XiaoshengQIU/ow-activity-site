import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleEditor } from "@/components/article-editor";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "编辑文章",
  robots: { index: false },
};
export default async function EditArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [admin, { id }] = await Promise.all([
    requirePermission("articles"),
    params,
  ]);
  const article = await prisma.article.findUnique({
    where: { id },
  });
  if (!article) notFound();
  return (
    <main className="page-shell">
      <ArticleEditor
        key={`${admin.id}:${article.id}`}
        id={article.id}
        adminId={admin.id}
        initial={{
          title: article.title,
          excerpt: article.excerpt,
          coverUrl: article.coverUrl,
          content: article.content,
        }}
        initialRevision={article.revision}
        initialStatus={article.status}
        initialPinned={article.pinned}
        initialUpdatedAt={article.updatedAt.toISOString()}
        initialPublishedAt={article.publishedAt?.toISOString() ?? null}
      />
    </main>
  );
}
