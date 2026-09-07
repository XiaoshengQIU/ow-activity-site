-- 文章置顶：置顶的排在列表和首页最前，其余仍按发布时间倒序。
ALTER TABLE "Article" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Article_status_pinned_publishedAt_idx" ON "Article"("status", "pinned", "publishedAt");
