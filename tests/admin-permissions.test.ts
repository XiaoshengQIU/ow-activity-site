import test from "node:test";
import assert from "node:assert/strict";
import {
  adminRankLabel,
  canSeeAdminHref,
  grantedPermissions,
  hasPermission,
  isPrimaryAdmin,
  normalizeRestoredAdmins,
  parseGrantedPermissions,
  planStaffAssignment,
} from "../src/lib/admin-permissions";

const primary = {
  id: "p1",
  role: "ADMIN" as const,
  status: "APPROVED" as const,
  primaryAdmin: true,
  adminPermissions: [] as string[],
};
const deputy = {
  id: "d1",
  role: "ADMIN" as const,
  status: "APPROVED" as const,
  primaryAdmin: false,
  adminPermissions: ["events", "articles"],
};

test("首位管理员始终拥有全部可派发权限", () => {
  assert.equal(isPrimaryAdmin(primary), true);
  assert.equal(hasPermission(primary, "backup"), true);
  assert.equal(hasPermission(primary, "users"), true);
  assert.equal(adminRankLabel(primary), "首位管理员");
});

test("次级管理员只拥有被勾选的权限", () => {
  assert.equal(hasPermission(deputy, "events"), true);
  assert.equal(hasPermission(deputy, "backup"), false);
  assert.equal(canSeeAdminHref("/admin/events/new", deputy), true);
  assert.equal(canSeeAdminHref("/admin/backup", deputy), false);
  assert.deepEqual(grantedPermissions(deputy), ["events", "articles"]);
});

test("旧管理员没有权限列表时仍视为全权，避免升级后锁死", () => {
  const legacy = {
    role: "ADMIN",
    status: "APPROVED",
    primaryAdmin: false,
    adminPermissions: [],
  };
  assert.equal(hasPermission(legacy, "oauth"), true);
});

test("权限名全部无法识别时按无权限处理，不退回全权", () => {
  // 空列表是老数据，保持全权；有值却认不出来是脏数据或废弃的权限名，
  // 这时再放行等于把误写的字段变成提权。
  const dirty = {
    role: "ADMIN",
    status: "APPROVED",
    primaryAdmin: false,
    adminPermissions: ["evnets", "已删除的权限"],
  };
  assert.equal(hasPermission(dirty, "oauth"), false);
  assert.equal(hasPermission(dirty, "users"), false);
  const partial = { ...dirty, adminPermissions: ["events", "不认识"] };
  assert.equal(hasPermission(partial, "events"), true);
  assert.equal(hasPermission(partial, "backup"), false);
});

test("普通玩家没有任何后台权限", () => {
  assert.equal(
    hasPermission({ role: "USER", status: "APPROVED" }, "users"),
    false,
  );
  assert.equal(parseGrantedPermissions(["events", "nope", "backup"]).length, 2);
});

test("只有首位管理员能指定或撤销次级管理员", () => {
  const player = {
    id: "u1",
    role: "USER",
    status: "APPROVED",
    primaryAdmin: false,
  };
  const denied = planStaffAssignment({
    actor: deputy,
    target: player,
    action: "save",
    permissions: ["events"],
  });
  assert.ok("error" in denied);

  const saved = planStaffAssignment({
    actor: primary,
    target: player,
    action: "save",
    permissions: ["events", "articles"],
  });
  assert.ok("data" in saved);
  assert.deepEqual(saved.data.adminPermissions, ["events", "articles"]);
  assert.equal(saved.data.role, "ADMIN");

  const blocked = planStaffAssignment({
    actor: primary,
    target: { ...primary, id: "p1" },
    action: "revoke",
    permissions: [],
  });
  assert.ok("error" in blocked);
});

test("恢复旧备份时补首位管理员标记", () => {
  const users = [
    {
      id: "a",
      role: "ADMIN",
      status: "APPROVED",
      primaryAdmin: false,
      adminPermissions: [],
    },
    { id: "b", role: "USER", status: "APPROVED" },
  ];
  normalizeRestoredAdmins(users);
  assert.equal(users[0].primaryAdmin, true);
  assert.equal(users[1].primaryAdmin, undefined);
});
