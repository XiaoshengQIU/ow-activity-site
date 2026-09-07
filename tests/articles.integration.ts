import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  saveArticle,
  deleteArticle,
  publicArticleWhere,
  ArticleConflictError,
} from "../src/lib/article-service";
import {
  articleEditorState,
  type ArticleInput,
} from "../src/lib/article-input";

const connectionString = process.env.ARTICLE_TEST_DATABASE_URL;
if (!connectionString)
  throw new Error(
    "请设置 ARTICLE_TEST_DATABASE_URL，文章测试仅操作独立临时 schema。",
  );
test("文章权限、草稿隔离、发布撤回、并发覆盖保护与删除", async () => {
  const schema = "article_test_" + randomUUID().replaceAll("-", "");
  assert.match(schema, /^article_test_[a-f0-9]{32}$/);
  const client = new Client({ connectionString });
  await client.connect();
  let db: PrismaClient | undefined;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    for (const migration of (await readdir("prisma/migrations"))
      .filter((name) => /^\d/.test(name))
      .sort()) {
      const sql = (
        await readFile(`prisma/migrations/${migration}/migration.sql`, "utf8")
      ).replace('CREATE SCHEMA IF NOT EXISTS "public";', "");
      await client.query(sql);
    }
    db = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString, max: 1, options: `-c search_path=${schema}` },
        { schema },
      ),
    });
    const admin = await db.user.create({
      data: { username: "article-admin", role: "ADMIN", status: "APPROVED" },
    });
    const input: ArticleInput = {
      id: randomUUID(),
      revision: 0,
      title: "交大活动回顾",
      excerpt: "",
      coverUrl: "",
      content: "## 当天回顾\n\n第一段内容。",
      status: "DRAFT",
      pinned: false,
    };
    for (const actor of [
      null,
      { ...admin, role: "USER" },
      { ...admin, status: "BANNED" },
    ])
      await assert.rejects(saveArticle(db, actor, input), /无权/);
    const savedDraft = await saveArticle(db, admin, {
      ...input,
      title: "  交大活动回顾  ",
    });
    assert.equal(savedDraft.operation, "draft-saved");
    assert.equal(savedDraft.article.title, input.title);
    assert.ok(savedDraft.article.excerpt.includes("第一段内容"));
    assert.equal(savedDraft.publishedAt, null);
    assert.equal(
      articleEditorState(savedDraft.status, savedDraft.revision, false),
      "草稿已保存",
    );
    assert.equal(articleEditorState("DRAFT", 0, false), "未保存新稿");
    await assert.rejects(saveArticle(db, admin, input), ArticleConflictError);
    assert.equal(await db.article.count({ where: publicArticleWhere }), 0);
    const published = await saveArticle(db, admin, {
      ...input,
      revision: 1,
      status: "PUBLISHED",
    });
    assert.equal(published.revision, 2);
    assert.equal(published.operation, "published");
    assert.equal(
      articleEditorState(published.status, published.revision, false),
      "已发布",
    );
    assert.equal(
      articleEditorState(published.status, published.revision, true),
      "已发布 · 有未保存修改",
    );
    const publicRow = await db.article.findFirstOrThrow({
      where: { ...publicArticleWhere, id: input.id },
    });
    assert.ok(publicRow.publishedAt);
    assert.ok(publicRow.excerpt.includes("第一段内容"));
    const firstPublishedAt = publicRow.publishedAt.toISOString();
    assert.equal(published.publishedAt, firstPublishedAt);
    assert.equal(published.updatedAt, publicRow.updatedAt.toISOString());
    await assert.rejects(
      saveArticle(db, admin, { ...input, revision: 1, title: "过期内容" }),
      ArticleConflictError,
    );
    assert.equal(
      (await db.article.findUniqueOrThrow({ where: { id: input.id } })).title,
      input.title,
    );
    const races = await Promise.allSettled([
      saveArticle(db, admin, {
        ...input,
        revision: 2,
        status: "PUBLISHED",
        title: "修改 A",
      }),
      saveArticle(db, admin, {
        ...input,
        revision: 2,
        status: "PUBLISHED",
        title: "修改 B",
      }),
    ]);
    assert.equal(
      races.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const successfulUpdate = races.find(
      (result) => result.status === "fulfilled",
    );
    assert.equal(
      successfulUpdate?.status === "fulfilled" &&
        successfulUpdate.value.operation,
      "updated",
    );
    const withdrawn = await saveArticle(db, admin, {
      ...input,
      revision: 3,
      status: "DRAFT",
    });
    assert.equal(withdrawn.operation, "withdrawn");
    assert.equal(
      articleEditorState(withdrawn.status, withdrawn.revision, false),
      "草稿已保存",
    );
    assert.equal(await db.article.count({ where: publicArticleWhere }), 0);
    await saveArticle(db, admin, {
      ...input,
      revision: 4,
      status: "PUBLISHED",
    });
    assert.equal(
      (
        await db.article.findFirstOrThrow({ where: publicArticleWhere })
      ).publishedAt?.toISOString(),
      firstPublishedAt,
    );
    await assert.rejects(
      deleteArticle(db, { ...admin, role: "USER" }, input.id, 5),
      /无权/,
    );
    await assert.rejects(
      deleteArticle(db, admin, input.id, 4),
      ArticleConflictError,
    );
    await deleteArticle(db, admin, input.id, 5);
    assert.equal(await db.article.count(), 0);
    const directId = randomUUID();
    const directlyPublished = await saveArticle(db, admin, {
      ...input,
      id: directId,
      status: "PUBLISHED",
    });
    const directRow = await db.article.findFirstOrThrow({
      where: { ...publicArticleWhere, id: directId },
    });
    assert.equal(directlyPublished.operation, "published");
    assert.equal(directlyPublished.revision, directRow.revision);
    assert.equal(
      directlyPublished.publishedAt,
      directRow.publishedAt?.toISOString(),
    );
    assert.equal(
      directlyPublished.updatedAt,
      directRow.updatedAt.toISOString(),
    );
    assert.deepEqual(directlyPublished.article, {
      title: directRow.title,
      excerpt: directRow.excerpt,
      content: directRow.content,
      coverUrl: directRow.coverUrl,
    });
    await deleteArticle(db, admin, directId, directlyPublished.revision);
  } finally {
    await db?.$disconnect();
    try {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await client.end();
    }
  }
});
