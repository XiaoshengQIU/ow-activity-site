import { z } from "zod";

export const MAX_ARTICLE_LENGTH = 100_000;
export const articleStatusLabels = {
  DRAFT: "草稿",
  PUBLISHED: "已发布",
} as const;
export function safeArticleUrl(value: string, image = false): string {
  if (!value || /[\u0000-\u0020\u007f\\]/.test(value)) return "";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (!image && /^#[a-zA-Z0-9_\u4e00-\u9fff-]+$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.username || url.password) return "";
    return ["https:", "http:", ...(!image ? ["mailto:"] : [])].includes(
      url.protocol,
    )
      ? value
      : "";
  } catch {
    return "";
  }
}
export const articleIdentitySchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9-]{20,40}$/, "文章标识无效。"),
  revision: z.coerce.number().int().min(0).max(2147483646),
});
export const articleInputSchema = articleIdentitySchema
  .extend({
    title: z
      .string()
      .trim()
      .min(1, "请填写文章标题。")
      .max(120, "标题最多 120 字。"),
    excerpt: z.string().trim().max(300, "摘要最多 300 字。"),
    coverUrl: z
      .string()
      .trim()
      .max(2048)
      .refine(
        (value) => value === "" || !!safeArticleUrl(value, true),
        "封面请使用 HTTP、HTTPS 或本站图片地址。",
      ),
    content: z.string().max(MAX_ARTICLE_LENGTH, "正文最多 10 万字符。"),
    status: z.enum(["DRAFT", "PUBLISHED"]),
    // 表单提交过来是字符串，服务端调用直接传布尔。
    pinned: z
      .union([z.boolean(), z.literal("true"), z.literal("false")])
      .default(false)
      .transform((value) => value === true || value === "true"),
  })
  .refine(
    (value) => value.status !== "PUBLISHED" || value.content.trim().length > 0,
    { message: "请填写正文后再发布。", path: ["content"] },
  );
export type ArticleInput = z.infer<typeof articleInputSchema>;
export type ArticleDraft = Pick<
  ArticleInput,
  "title" | "excerpt" | "coverUrl" | "content"
>;
export type ArticleResult = {
  ok: boolean;
  message: string;
  revision?: number;
  status?: "DRAFT" | "PUBLISHED";
  article?: ArticleDraft;
  updatedAt?: string;
  publishedAt?: string | null;
  authRequired?: boolean;
};
const recoveryDraftSchema = z.object({
  title: z.string().max(120),
  excerpt: z.string().max(300),
  coverUrl: z.string().max(2048),
  content: z.string().max(MAX_ARTICLE_LENGTH),
});
const articleRecoverySchema = articleIdentitySchema.extend({
  version: z.literal(1),
  userId: z.string().min(1).max(100),
  draft: recoveryDraftSchema,
  savedAt: z.number().int().positive(),
});
export type ArticleRecovery = z.infer<typeof articleRecoverySchema>;
export const ARTICLE_RECOVERY_TTL = 24 * 60 * 60 * 1000;
export function articleRecoveryKey(userId: string, id: string | "new") {
  return `community.article.${encodeURIComponent(userId)}.${id}`;
}
export function parseArticleRecovery(
  raw: string | null,
  userId: string,
  id: string | "new",
  now = Date.now(),
): ArticleRecovery | null {
  if (!raw) return null;
  try {
    const result = articleRecoverySchema.safeParse(JSON.parse(raw));
    if (!result.success) return null;
    const backup = result.data;
    if (
      backup.userId !== userId ||
      (id === "new" ? backup.revision !== 0 : backup.id !== id) ||
      backup.savedAt > now + 60_000 ||
      now - backup.savedAt > ARTICLE_RECOVERY_TTL
    )
      return null;
    return backup;
  } catch {
    return null;
  }
}
export function sameArticleDraft(a: ArticleDraft, b: ArticleDraft) {
  return (
    a.title.trim() === b.title.trim() &&
    a.coverUrl.trim() === b.coverUrl.trim() &&
    articleExcerpt({ ...a, excerpt: a.excerpt.trim() }) ===
      articleExcerpt({ ...b, excerpt: b.excerpt.trim() }) &&
    a.content === b.content
  );
}
export function articleEditorState(
  status: "DRAFT" | "PUBLISHED",
  revision: number,
  dirty: boolean,
) {
  if (status === "PUBLISHED") return dirty ? "已发布 · 有未保存修改" : "已发布";
  if (!revision) return "未保存新稿";
  return dirty ? "草稿 · 有未保存修改" : "草稿已保存";
}
export function articleTime(value: Date | string | null) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value))
    : "";
}
export function articleExcerpt(article: { excerpt: string; content?: string }) {
  return (
    article.excerpt ||
    (article.content ?? "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]*>/g, "")
      .replace(/[#*_`>~|\[\]-]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160)
  );
}
export function articleDate(value: Date | string | null) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(new Date(value))
    : "尚未发布";
}
