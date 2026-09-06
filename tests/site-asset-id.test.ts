import test from "node:test";
import assert from "node:assert/strict";
import { siteAssetId } from "../src/lib/backup-service";
import { isSafeImageSource } from "../src/lib/site-config";

// /api/site-assets/[id] 路由用的校验，必须和生成的 id 保持一致。
const ROUTE_ID = /^[a-z0-9]{20,40}$/;

test("备份生成的头像资源 id 能被读取路由和图片白名单接受", () => {
  for (let index = 0; index < 200; index++) {
    const id = siteAssetId();
    assert.ok(
      ROUTE_ID.test(id),
      `id ${id} 不符合 /api/site-assets/[id] 的校验，恢复后头像会 404`,
    );
    assert.ok(
      isSafeImageSource(`/api/site-assets/${id}`),
      `id ${id} 不被 isSafeImageSource 接受，管理员保存时会被拒绝`,
    );
  }
});

test("带连字符的 UUID 正是此前 404 的原因", () => {
  // 修复前用的是 "backup-avatar-" + randomUUID()，留作回归说明。
  assert.equal(ROUTE_ID.test("backup-avatar-8496a554-a0a7-4544-8843-af111517eff2"), false);
});
