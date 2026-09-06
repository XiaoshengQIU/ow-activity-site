"use server";

import bcrypt from "bcryptjs";
import {
  revalidateAccount,
  revalidateAdminUsers,
  revalidateEvents,
  revalidateHome,
  revalidatePlayers,
} from "@/lib/revalidate-site";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  canJoinEvents,
  createSession,
  destroySession,
  getCurrentUser,
  redirectIfAdminSetupOpen,
  requireUser,
} from "@/lib/auth";
import {
  ADMIN_PERMISSIONS,
  hasPermission,
  isPrimaryAdmin,
  planStaffAssignment,
} from "@/lib/admin-permissions";
import { applyProfileReview } from "@/lib/profile-review";
import { avatarFileToBytes } from "@/lib/avatar-upload";
import { storeSiteAsset } from "@/lib/asset-storage";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { parseEventInput } from "@/lib/event-input";
import { eventStatusLabels } from "@/lib/format";
import { syncEventStatuses } from "@/lib/event-schedule";

export type FormState = {
  message: string;
  errors?: Record<string, string[] | undefined>;
};

const emptyState: FormState = { message: "" };

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function checkbox(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function list(value: string) {
  return value
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function playerRole(value: string) {
  return ["TANK", "DAMAGE", "SUPPORT", "FLEX"].includes(value)
    ? (value as "TANK" | "DAMAGE" | "SUPPORT" | "FLEX")
    : null;
}

function databaseErrorState(error: unknown): FormState {
  if (error instanceof Error && error.message.includes("数据库还没有配置")) {
    return { message: error.message };
  }

  return { message: "操作失败，请稍后再试。" };
}

const registerSchema = z.object({
  username: z
    .string()
    .min(3, "用户名至少 3 位")
    .max(24, "用户名最多 24 位")
    .regex(/^[a-zA-Z0-9_]+$/, "用户名只能包含字母、数字和下划线"),
  password: z.string().min(8, "密码至少 8 位").max(72, "密码最多 72 位"),
  displayName: z.string().min(2, "昵称至少 2 位").max(20, "昵称最多 20 位"),
  slogan: z.string().max(80, "宣言最多 80 字"),
});

export async function registerAction(
  _prevState: FormState = emptyState,
  formData: FormData,
): Promise<FormState> {
  void _prevState;
  await redirectIfAdminSetupOpen();

  const parsed = registerSchema.safeParse({
    username: text(formData, "username"),
    password: text(formData, "password"),
    displayName: text(formData, "displayName"),
    slogan: text(formData, "slogan"),
  });

  if (!parsed.success) {
    return {
      message: "请检查注册信息。",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    assertDatabaseConfigured();

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);

    const user = await prisma.user.create({
      data: {
        username: parsed.data.username,
        passwordHash,
        profile: {
          create: {
            displayName: parsed.data.displayName,
            slogan: parsed.data.slogan,
            reviewStatus: "PENDING",
          },
        },
      },
    });

    await createSession(user.id);
    const { maybeAutoReviewByUserId } = await import("@/lib/ai/review");
    await maybeAutoReviewByUserId(user.id);
  } catch (error) {
    if (error instanceof Error && /unique constraint/i.test(error.message)) {
      return { message: "这个用户名已经被注册。" };
    }

    return databaseErrorState(error);
  }

  redirect("/me?registered=1");
}

const loginSchema = z.object({
  username: z.string().min(1, "请输入用户名"),
  password: z.string().min(1, "请输入密码"),
});

export async function loginAction(
  _prevState: FormState = emptyState,
  formData: FormData,
): Promise<FormState> {
  void _prevState;
  await redirectIfAdminSetupOpen();

  const parsed = loginSchema.safeParse({
    username: text(formData, "username"),
    password: text(formData, "password"),
  });

  if (!parsed.success) {
    return {
      message: "请填写用户名和密码。",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  let target = "/me";

  try {
    assertDatabaseConfigured();

    const user = await prisma.user.findUnique({
      where: { username: parsed.data.username },
      include: { profile: true },
    });

    if (!user || !user.passwordHash || user.status === "BANNED") {
      return { message: "用户名或密码不正确。" };
    }

    const passwordMatches = await bcrypt.compare(
      parsed.data.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      return { message: "用户名或密码不正确。" };
    }

    await createSession(user.id);
    target = user.role === "ADMIN" ? "/admin" : "/me";
  } catch (error) {
    return databaseErrorState(error);
  }

  redirect(target);
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}

const profileSchema = z.object({
  displayName: z.string().min(2, "昵称至少 2 位").max(20, "昵称最多 20 位"),
  slogan: z.string().max(80, "宣言最多 80 字"),
  avatarUrl: z.string().url("头像必须是有效链接").or(z.literal("")),
  battleTag: z.string().max(60, "战网 ID 过长"),
  mainRole: z.enum(["TANK", "DAMAGE", "SUPPORT", "FLEX"]).or(z.literal("")),
  mainHeroes: z.string().max(120, "常用英雄列表过长"),
  rank: z.string().max(40, "段位过长"),
  onlineTime: z.string().max(80, "在线时间过长"),
  contact: z.string().max(120, "联系方式过长"),
  extraNote: z.string().max(300, "备注最多 300 字"),
});

export async function updateProfileAction(formData: FormData) {
  const user = await requireUser();
  // 被封禁的账号不能改资料。下面会把未通过的账号重置为 PENDING，
  // 少了这道拦截，封禁用户保存一次资料就能把自己送回待审核队列。
  if (user.status === "BANNED") redirect("/me?error=banned");
  const avatarFile = formData.get("avatarFile");

  const parsed = profileSchema.safeParse({
    displayName: text(formData, "displayName"),
    slogan: text(formData, "slogan"),
    avatarUrl: text(formData, "avatarUrl"),
    battleTag: text(formData, "battleTag"),
    mainRole: text(formData, "mainRole"),
    mainHeroes: text(formData, "mainHeroes"),
    rank: text(formData, "rank"),
    onlineTime: text(formData, "onlineTime"),
    contact: text(formData, "contact"),
    extraNote: text(formData, "extraNote"),
  });

  if (!parsed.success) {
    redirect("/me?error=profile");
  }

  let avatarUrl = parsed.data.avatarUrl || user.profile?.avatarUrl || null;

  if (checkbox(formData, "removeAvatar")) {
    avatarUrl = null;
  }

  if (avatarFile instanceof File && avatarFile.size > 0) {
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = await avatarFileToBytes(avatarFile);
    } catch (error) {
      const code = error instanceof Error ? error.message : "avatar-type";
      redirect(`/me?error=${encodeURIComponent(code)}`);
    }
    const asset = await storeSiteAsset({
      data: bytes,
      name: avatarFile.name.slice(0, 200) || "头像",
      mimeType: avatarFile.type,
      uploadedById: user.id,
    });
    avatarUrl = "/api/site-assets/" + asset.id;
  }

  const reviewStatus = user.role === "ADMIN" ? "APPROVED" : "PENDING";

  const profile = await prisma.profile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      displayName: parsed.data.displayName,
      slogan: parsed.data.slogan,
      avatarUrl,
      battleTag: parsed.data.battleTag || null,
      mainRole: parsed.data.mainRole || null,
      mainHeroes: list(parsed.data.mainHeroes),
      rank: parsed.data.rank || null,
      onlineTime: parsed.data.onlineTime || null,
      contact: parsed.data.contact || null,
      extraNote: parsed.data.extraNote || null,
      reviewStatus,
    },
    update: {
      displayName: parsed.data.displayName,
      slogan: parsed.data.slogan,
      avatarUrl,
      battleTag: parsed.data.battleTag || null,
      mainRole: parsed.data.mainRole || null,
      mainHeroes: list(parsed.data.mainHeroes),
      rank: parsed.data.rank || null,
      onlineTime: parsed.data.onlineTime || null,
      contact: parsed.data.contact || null,
      extraNote: parsed.data.extraNote || null,
      reviewStatus,
      reviewNote: null,
      reviewedById: null,
      reviewedAt: null,
    },
  });

  if (user.role !== "ADMIN" && user.status !== "APPROVED") {
    await prisma.user.update({
      where: { id: user.id },
      data: { status: "PENDING" },
    });
  }

  if (reviewStatus === "PENDING") {
    const { maybeAutoReviewProfile } = await import("@/lib/ai/review");
    await maybeAutoReviewProfile(profile.id);
  }

  revalidateAccount();
  revalidatePlayers();
  revalidateHome();
  redirect("/me?saved=profile");
}

function userManagementReturn(formData: FormData, saved: string) {
  const candidate = text(formData, "returnTo");
  const params = new URLSearchParams(
    candidate.startsWith("/admin/users?")
      ? candidate.slice("/admin/users?".length)
      : "",
  );
  const safe = new URLSearchParams();
  for (const key of ["status", "q", "page"]) {
    const value = params.get(key);
    if (value) safe.set(key, value.slice(0, 100));
  }
  safe.set("saved", saved);
  return "/admin/users?" + safe;
}

export type AdminUserFormResult = {
  ok: boolean;
  message: string;
  authRequired?: boolean;
  redirectTo?: string;
};

export async function reviewProfileAction(
  formData: FormData,
): Promise<AdminUserFormResult> {
  const admin = await getCurrentUser();
  if (!hasPermission(admin, "users")) {
    return {
      ok: false,
      authRequired: true,
      message:
        "登录已失效或当前账号没有用户审核权限。审核备注已保留，重新登录后可继续操作。",
    };
  }
  const profileId = text(formData, "profileId");
  const decision = text(formData, "decision");
  const note = text(formData, "reviewNote");

  if (!profileId || !["APPROVED", "REJECTED"].includes(decision)) {
    return {
      ok: false,
      message: "审核信息无效，请检查后重试。填写内容已保留。",
    };
  }

  const approved = decision === "APPROVED";
  const profileStatus = approved
    ? ("APPROVED" as const)
    : ("REJECTED" as const);

  try {
    await applyProfileReview({
      profileId,
      decision: profileStatus,
      note: note || null,
      reviewerId: admin.id,
    });
  } catch {
    return {
      ok: false,
      message: "审核失败，资料可能已发生变化。审核备注已保留，请重试。",
    };
  }

  revalidateAdminUsers();
  revalidatePlayers();
  revalidateHome();
  return {
    ok: true,
    message: approved ? "资料已通过审核。" : "资料已拒绝。",
    redirectTo: userManagementReturn(formData, decision),
  };
}

export async function updateUserStatusAction(
  formData: FormData,
): Promise<AdminUserFormResult> {
  const admin = await getCurrentUser();
  if (!hasPermission(admin, "users")) {
    return {
      ok: false,
      authRequired: true,
      message:
        "登录已失效或当前账号没有用户管理权限。当前选择已保留，重新登录后可继续操作。",
    };
  }
  const userId = text(formData, "userId");
  const status = text(formData, "status");

  if (
    !userId ||
    !["PENDING", "APPROVED", "REJECTED", "BANNED"].includes(status)
  ) {
    return {
      ok: false,
      message: "账号状态无效，请检查后重试。当前选择已保留。",
    };
  }

  try {
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, primaryAdmin: true },
    });
    if (!target) {
      return {
        ok: false,
        message: "账号状态更新失败，用户可能已发生变化。当前选择已保留，请重试。",
      };
    }
    if (target.primaryAdmin || target.id === admin!.id) {
      return { ok: false, message: "不能修改首位管理员或自己的账号状态。" };
    }
    if (target.role === "ADMIN" && !isPrimaryAdmin(admin)) {
      return { ok: false, message: "次级管理员不能修改其他管理员的账号状态。" };
    }
    await prisma.user.update({
      where: { id: userId },
      data: {
        status: status as "PENDING" | "APPROVED" | "REJECTED" | "BANNED",
      },
    });
    // 登录接口会拦下封禁账号，但已经签发的会话不会自己过期。
    if (status === "BANNED") {
      await prisma.session.deleteMany({ where: { userId } });
    }
  } catch {
    return {
      ok: false,
      message: "账号状态更新失败，用户可能已发生变化。当前选择已保留，请重试。",
    };
  }

  revalidateAdminUsers();
  revalidatePlayers();
  return {
    ok: true,
    message: "账号状态已更新。",
    redirectTo: userManagementReturn(formData, "status"),
  };
}

export async function assignStaffAction(
  formData: FormData,
): Promise<AdminUserFormResult> {
  const admin = await getCurrentUser();
  const userId = text(formData, "userId");
  const action = text(formData, "staffAction") === "revoke" ? "revoke" : "save";
  if (!userId) {
    return { ok: false, message: "玩家信息无效，请刷新后重试。" };
  }
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, status: true, primaryAdmin: true },
  });
  if (!target) {
    return { ok: false, message: "找不到这位玩家，请刷新后重试。" };
  }
  const planned = planStaffAssignment({
    actor: admin,
    target,
    action,
    permissions: ADMIN_PERMISSIONS.filter(
      (permission) => formData.get("permission-" + permission) === "on",
    ),
  });
  if ("error" in planned) {
    return {
      ok: false,
      authRequired: !isPrimaryAdmin(admin),
      message: planned.error,
    };
  }
  try {
    await prisma.user.update({
      where: { id: userId },
      data: planned.data,
    });
  } catch {
    return { ok: false, message: "权限更新失败，请稍后重试。" };
  }
  revalidateAdminUsers();
  return {
    ok: true,
    message: action === "revoke" ? "已撤销次级管理员。" : "已保存次级管理员权限。",
    redirectTo: userManagementReturn(formData, "staff"),
  };
}

function eventFormInput(formData: FormData) {
  return Object.fromEntries(
    [
      "title",
      "type",
      "customType",
      "description",
      "coverUrl",
      "eventDate",
      "signupDeadline",
      "maxParticipants",
      "requirements",
      "voiceChannel",
      "status",
    ].map((key) => [key, text(formData, key)]),
  );
}

export type EventFormResult = {
  ok: boolean;
  message: string;
  redirectTo?: string;
  authRequired?: boolean;
};

export async function createEventAction(
  formData: FormData,
): Promise<EventFormResult> {
  const admin = await getCurrentUser();
  if (!hasPermission(admin, "events")) {
    return {
      ok: false,
      authRequired: true,
      message:
        "登录已失效或当前账号没有活动管理权限。填写内容已保留，重新登录后可继续保存。",
    };
  }
  const parsed = parseEventInput(eventFormInput(formData));
  if (!parsed.ok)
    return {
      ok: false,
      message:
        parsed.error === "date"
          ? "请填写有效日期，报名截止日期不得晚于活动日期。"
          : parsed.error === "cover"
            ? "封面链接无效，请使用 HTTP、HTTPS 或本站上传的图片。"
            : "活动信息格式有误，请检查必填内容与字数限制。",
    };
  const event = await prisma.event.create({
    data: { ...parsed.data, createdById: admin.id },
  });
  revalidateEvents(event.id);
  if (event.status !== "DRAFT") revalidateHome();
  return {
    ok: true,
    message:
      event.status === "DRAFT"
        ? "活动草稿已创建，仅管理员可见。"
        : "活动已创建并发布。",
    redirectTo: `/admin/events/${event.id}?created=1&view=settings`,
  };
}

export async function updateEventAction(
  formData: FormData,
): Promise<EventFormResult> {
  const admin = await getCurrentUser();
  if (!hasPermission(admin, "events")) {
    return {
      ok: false,
      authRequired: true,
      message:
        "登录已失效或当前账号没有活动管理权限。填写内容已保留，重新登录后可继续保存。",
    };
  }
  const eventId = text(formData, "eventId");
  if (!eventId) redirect("/admin/events");
  const parsed = parseEventInput(eventFormInput(formData));
  if (!parsed.ok)
    return {
      ok: false,
      message:
        parsed.error === "date"
          ? "请填写有效日期，报名截止日期不得晚于活动日期。"
          : parsed.error === "cover"
            ? "封面链接无效，请使用 HTTP、HTTPS 或本站上传的图片。"
            : "活动信息格式有误，请检查必填内容与字数限制。",
    };
  await prisma.event.update({ where: { id: eventId }, data: parsed.data });
  revalidateEvents(eventId);
  revalidateHome();
  return {
    ok: true,
    message: `活动已保存 · ${eventStatusLabels[parsed.data.status]}${parsed.data.status === "DRAFT" ? "，仅管理员可见。" : "，前台已同步更新。"}`,
  };
}

export async function registerEventAction(formData: FormData) {
  const user = await requireUser();
  const eventId = text(formData, "eventId");

  if (!eventId) {
    redirect("/events");
  }

  if (!canJoinEvents(user)) {
    redirect(`/events/${eventId}?error=profile`);
  }

  await syncEventStatuses();
  const [event, approvedCount, existing] = await Promise.all([
    prisma.event.findUnique({
      where: { id: eventId },
      select: {
        status: true,
        signupClosed: true,
        signupDeadline: true,
        maxParticipants: true,
      },
    }),
    prisma.eventRegistration.count({
      where: { eventId, status: "APPROVED" },
    }),
    prisma.eventRegistration.findUnique({
      where: { eventId_userId: { eventId, userId: user.id } },
      select: { id: true, status: true },
    }),
  ]);

  if (
    !event ||
    event.signupClosed ||
    !["OPEN", "RUNNING"].includes(event.status)
  ) {
    redirect(`/events/${eventId}?error=closed`);
  }

  if (event.signupDeadline && event.signupDeadline < new Date()) {
    redirect(`/events/${eventId}?error=deadline`);
  }

  if (approvedCount >= event.maxParticipants) {
    redirect(`/events/${eventId}?error=full`);
  }

  if (existing && existing.status !== "CANCELLED") {
    redirect(`/events/${eventId}?error=registered`);
  }

  const payload = {
    preferredRole: playerRole(text(formData, "preferredRole")),
    heroes: list(text(formData, "heroes")),
    voiceAvailable: checkbox(formData, "voiceAvailable"),
    note: text(formData, "note") || null,
    status: "PENDING" as const,
  };

  if (existing) {
    await prisma.eventRegistration.update({
      where: { id: existing.id },
      data: payload,
    });
  } else {
    await prisma.eventRegistration.create({
      data: {
        ...payload,
        eventId,
        userId: user.id,
      },
    });
  }

  revalidateEvents(eventId);
  redirect(`/events/${eventId}?registered=1`);
}

export async function cancelRegistrationAction(formData: FormData) {
  const user = await requireUser();
  const eventId = text(formData, "eventId");

  if (!eventId) {
    redirect("/events");
  }

  await prisma.eventRegistration.updateMany({
    where: { eventId, userId: user.id },
    data: { status: "CANCELLED" },
  });

  revalidateEvents(eventId);
  revalidateHome();
  redirect(`/events/${eventId}?cancelled=1`);
}

export async function reviewRegistrationAction(
  formData: FormData,
): Promise<AdminUserFormResult> {
  const admin = await getCurrentUser();
  if (!hasPermission(admin, "events")) {
    return {
      ok: false,
      authRequired: true,
      message:
        "登录已失效或当前账号没有活动管理权限。请重新登录后再审核。",
    };
  }
  const registrationId = text(formData, "registrationId");
  const eventId = text(formData, "eventId");
  const decision = text(formData, "decision");
  const tab = text(formData, "reviewTab");
  const reviewTab = ["PENDING", "APPROVED", "REJECTED"].includes(tab)
    ? tab
    : "PENDING";
  if (
    !registrationId ||
    !eventId ||
    !["APPROVED", "REJECTED"].includes(decision)
  ) {
    return { ok: false, message: "报名信息无效，请刷新后重试。" };
  }

  const result = await prisma.$transaction(async (tx) => {
        // 同一活动串行审核，避免多人同时通过报名时超出人数上限。
        await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`;
        const registration = await tx.eventRegistration.findFirst({
          where: { id: registrationId, eventId, status: { not: "CANCELLED" } },
        });
        if (!registration) return "registration";
        if (decision === "APPROVED" && registration.status !== "APPROVED") {
          const event = await tx.event.findUnique({
            where: { id: eventId },
            select: { maxParticipants: true },
          });
          const approvedCount = await tx.eventRegistration.count({
            where: { eventId, status: "APPROVED" },
          });
          if (!event || approvedCount >= event.maxParticipants) return "full";
        }
        const saved = await tx.eventRegistration.updateMany({
          where: { id: registrationId, eventId, status: { not: "CANCELLED" } },
          data: {
            status: decision as "APPROVED" | "REJECTED",
            reviewedById: admin.id,
            reviewedAt: new Date(),
          },
        });
        return saved.count ? "saved" : "registration";
      });

  revalidateEvents(eventId);
  revalidateHome();
  const path = `/admin/events/${eventId}?review=${reviewTab}#registration-review`;
  if (result !== "saved") {
    return {
      ok: false,
      message:
        result === "full"
          ? "通过人数已满，无法再通过这份报名。"
          : "报名可能已变化，请刷新后重试。",
    };
  }
  return {
    ok: true,
    message: decision === "APPROVED" ? "报名已通过。" : "报名已拒绝。",
    redirectTo: `${path}&reviewed=${decision}`,
  };
}
