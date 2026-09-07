import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownManager } from "@tiptap/markdown";
import {
  articleInputSchema,
  safeArticleUrl,
  articleRecoveryKey,
  parseArticleRecovery,
  ARTICLE_RECOVERY_TTL,
  sameArticleDraft,
} from "../src/lib/article-input";
import { articleEditorExtensions } from "../src/lib/article-editor-extensions";
import { ArticleContent } from "../src/components/article-content";

const draft = {
  id: "a123456789012345678901",
  revision: 0,
  title: "测试文章",
  excerpt: "",
  coverUrl: "",
  content: "",
  status: "DRAFT",
};
test("未保存备份按管理员与文章隔离，拒绝过期、损坏和不属于新稿的记录", () => {
  const now = Date.now();
  const content = {
    title: "未完成标题",
    content: "正文仍在编辑",
    excerpt: "",
    coverUrl: "暂未写完的图片地址",
  };
  const backup = {
    version: 1,
    userId: "admin-a",
    id: draft.id,
    revision: 0,
    draft: content,
    savedAt: now,
  };
  const raw = JSON.stringify(backup);
  assert.deepEqual(
    parseArticleRecovery(raw, "admin-a", draft.id, now)?.draft,
    content,
  );
  assert.equal(parseArticleRecovery(raw, "admin-b", draft.id, now), null);
  assert.equal(
    parseArticleRecovery(raw, "admin-a", "another123456789012345", now),
    null,
  );
  assert.equal(
    parseArticleRecovery(
      raw,
      "admin-a",
      draft.id,
      now + ARTICLE_RECOVERY_TTL + 1,
    ),
    null,
  );
  assert.equal(
    parseArticleRecovery(
      JSON.stringify({ ...backup, savedAt: now + 61_000 }),
      "admin-a",
      draft.id,
      now,
    ),
    null,
  );
  assert.equal(
    parseArticleRecovery("invalid-json", "admin-a", draft.id, now),
    null,
  );
  assert.equal(
    parseArticleRecovery(
      JSON.stringify({ ...backup, revision: -1 }),
      "admin-a",
      draft.id,
      now,
    ),
    null,
  );
  assert.equal(
    parseArticleRecovery(
      JSON.stringify({ ...backup, revision: 1 }),
      "admin-a",
      "new",
      now,
    ),
    null,
  );
  assert.equal(parseArticleRecovery(raw, "admin-a", "new", now)?.id, draft.id);
  assert.notEqual(
    articleRecoveryKey("admin-a", draft.id),
    articleRecoveryKey("admin-b", draft.id),
  );
  assert.equal(
    sameArticleDraft(
      { ...content, title: " 标题 ", excerpt: "" },
      { ...content, title: "标题", excerpt: "正文仍在编辑" },
    ),
    true,
  );
});
test("文章可保存空正文草稿，发布需正文，标题和大小受限", () => {
  assert.equal(articleInputSchema.parse(draft).status, "DRAFT");
  assert.equal(
    articleInputSchema.safeParse({ ...draft, status: "PUBLISHED" }).success,
    false,
  );
  assert.equal(
    articleInputSchema.safeParse({ ...draft, title: " " }).success,
    false,
  );
  assert.equal(
    articleInputSchema.safeParse({ ...draft, content: "a".repeat(100001) })
      .success,
    false,
  );
  assert.equal(
    articleInputSchema.safeParse({ ...draft, revision: -1 }).success,
    false,
  );
});
test("文章链接和图片拒绝脚本、伪协议与凭据，渲染不执行 HTML", () => {
  for (const url of [
    "javascript:alert(1)",
    "java\nscript:alert(1)",
    "data:image/svg+xml,<svg/>",
    "//evil.test/a",
    "/\\evil.test/a",
    "https://u:p@evil.test/a",
    "file:///x",
  ])
    assert.equal(safeArticleUrl(url, true), "");
  assert.equal(
    safeArticleUrl("https://example.org/a.png", true),
    "https://example.org/a.png",
  );
  const html = renderToStaticMarkup(
    <ArticleContent
      content={
        "# 测试\n\n<script>alert(1)</script>\n\n[危险](javascript:alert(1))\n\n![图片](data:image/svg+xml,test)\n\n[正常](https://example.org)\n\n```html\n<script>示例</script>\n```"
      }
    />,
  );
  assert.doesNotMatch(html, /<script|href="javascript|src="data:/);
  assert.match(html, /&lt;script&gt;示例&lt;\/script&gt;/);
  assert.match(html, /rel="noopener noreferrer"/);
});
test("常用 Markdown 经富文本解析导出后保留标题、中文、表格、任务和图片", () => {
  const manager = new MarkdownManager({ extensions: articleEditorExtensions });
  const original =
    "## 活动回顾\n\n**中文加粗**，*斜体*与~~删除线~~。\n\n> 队伍集结\n\n- 普通列表\n\n- [x] 已完成\n\n| 位置 | 英雄 |\n| --- | --- |\n| 支援 | 安娜 |\n\n![合照](/arena-v2.webp)\n\n[活动](https://example.org)\n\n```js\nconst n = 1\n```";
  const output = manager.serialize(manager.parse(original));
  for (const text of [
    "活动回顾",
    "**中文加粗**",
    "队伍集结",
    "已完成",
    "位置",
    "安娜",
    "![合照](/arena-v2.webp)",
    "https://example.org",
    "const n = 1",
  ])
    assert.ok(output.includes(text), text + "应保留");
  const html = renderToStaticMarkup(<ArticleContent content={output} />);
  assert.match(html, /<table>/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /<strong>中文加粗<\/strong>/);
});

test("文章输入接受表单字符串和布尔两种置顶写法，缺省为不置顶", () => {
  const base = {
    id: "a123456789012345678901",
    revision: 0,
    title: "标题",
    excerpt: "",
    coverUrl: "",
    content: "正文",
    status: "DRAFT" as const,
  };
  // 表单提交过来是字符串
  assert.equal(articleInputSchema.parse({ ...base, pinned: "true" }).pinned, true);
  assert.equal(articleInputSchema.parse({ ...base, pinned: "false" }).pinned, false);
  // 服务端直接传布尔
  assert.equal(articleInputSchema.parse({ ...base, pinned: true }).pinned, true);
  // 老调用点不传这个字段
  assert.equal(articleInputSchema.parse(base).pinned, false);
});
