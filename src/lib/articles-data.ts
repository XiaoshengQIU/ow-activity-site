import "server-only";
import { cache } from "react";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { publicArticleWhere } from "@/lib/article-service";
import { demoArticles } from "@/lib/demo-data";

export const articleCardSelect = {
  id: true,
  title: true,
  excerpt: true,
  coverUrl: true,
  pinned: true,
  publishedAt: true,
  author: { select: { profile: { select: { displayName: true } } } },
} as const;
export const getLatestArticles = cache(async (take = 3) => {
  if (!isDatabaseConfigured()) return demoArticles.slice(0, take);
  return prisma.article.findMany({
    where: publicArticleWhere,
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }, { id: "desc" }],
    take,
    select: articleCardSelect,
  });
});
export const getPublishedArticle = cache(async (id: string) => {
  if (!isDatabaseConfigured() || !/^[a-zA-Z0-9-]{20,40}$/.test(id)) return null;
  return prisma.article.findFirst({
    where: { ...publicArticleWhere, id },
    select: { ...articleCardSelect, content: true, updatedAt: true },
  });
});
