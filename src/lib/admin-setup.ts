import bcrypt from "bcryptjs";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  initialAdminSchema,
  type InitialAdminInput,
} from "@/lib/admin-setup-input";

export const ADMIN_SETUP_ID = "initial-admin";

export class AdminSetupClosedError extends Error {
  constructor() {
    super("管理员已创建，首次注册入口已关闭。请使用已有账号登录。");
  }
}

export async function canSetUpAdmin(db: PrismaClient) {
  // 每次整页加载都会问一次，两条查询没有先后依赖，并行只花一个往返。
  const [setup, admin] = await Promise.all([
    db.adminSetup.findUnique({ where: { id: ADMIN_SETUP_ID } }),
    db.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } }),
  ]);
  if (!setup || setup.completedAt) return false;

  return !admin;
}

export async function registerInitialAdmin(
  db: PrismaClient,
  input: InitialAdminInput,
) {
  const data = initialAdminSchema.parse(input);
  if (!(await canSetUpAdmin(db))) throw new AdminSetupClosedError();
  const passwordHash = await bcrypt.hash(data.password, 12);

  return db.$transaction(async (tx) => {
    // 原子更新会锁住唯一的初始化记录，并发提交只能有一个成功。
    // 后续创建失败时整个事务回滚，不会消耗首次注册机会。
    const claimed = await tx.adminSetup.updateMany({
      where: { id: ADMIN_SETUP_ID, completedAt: null },
      data: { completedAt: new Date() },
    });
    if (claimed.count !== 1) throw new AdminSetupClosedError();

    const existingAdmin = await tx.user.findFirst({
      where: { role: "ADMIN" },
      select: { id: true },
    });
    if (existingAdmin) throw new AdminSetupClosedError();

    return tx.user.create({
      data: {
        username: data.username,
        passwordHash,
        role: "ADMIN",
        status: "APPROVED",
        primaryAdmin: true,
        adminPermissions: [],
        profile: {
          create: {
            displayName: data.displayName,
            slogan: "一起组织下一场活动。",
            reviewStatus: "APPROVED",
          },
        },
      },
      select: { id: true },
    });
  });
}
