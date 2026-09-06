import Link from "next/link";
import { Card } from "@/components/ui";
import { CoverImage } from "@/components/cover-image";
import { articleDate, safeArticleUrl } from "@/lib/article-input";

export function ArticleCard({
  article,
  variant = "default",
}: {
  article: {
    id: string;
    title: string;
    excerpt: string;
    coverUrl: string;
    publishedAt: Date | null;
    author: { profile: { displayName: string } | null };
  };
  variant?: "default" | "featured" | "compact";
}) {
  const cover = safeArticleUrl(article.coverUrl, true);
  // 没有封面的文章用标题首字做字母标，卡片之间也能互相区分。
  const monogram = article.title.trim().slice(0, 1) || "文";
  // 同一篇文章始终是同一个色调，列表里几张卡片不会撞成一片。
  const tone =
    [...article.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4;
  return (
    <article className={`article-card article-card--${variant}`}>
      <Card className="cover-glass-card h-full gap-0 overflow-hidden">
        <Link
          href={`/articles/${article.id}`}
          className="article-card-cover cover-glass-image"
          tabIndex={-1}
          aria-hidden="true"
        >
          <CoverImage src={cover} alt="" />
          <span className="card-tile card-tile--article" data-tone={tone}>
            <span className="card-tile-glyph">{monogram}</span>
          </span>
        </Link>
        <div className="article-card-copy cover-glass-panel">
          <h2>
            <Link href={`/articles/${article.id}`}>{article.title}</Link>
          </h2>
          {article.excerpt ? (
            <p className="article-card-excerpt">{article.excerpt}</p>
          ) : null}
          <p className="article-meta">
            <time dateTime={article.publishedAt?.toISOString()}>
              {articleDate(article.publishedAt)}
            </time>
            <span>·</span>
            {article.author.profile?.displayName || "社区编辑"}
          </p>
        </div>
      </Card>
    </article>
  );
}
