"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type FormState } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { OAuthError, unlinkOAuthAccount } from "@/lib/oauth/accounts";
import { isOAuthProvider } from "@/lib/oauth/shared";
import { prisma } from "@/lib/prisma";
import { revalidateAccount } from "@/lib/revalidate-site";

export type PasswordFormState = FormState & { ok?: boolean };

const emptyState: FormState = { message: "" };

const passwordValueSchema = z
  .string()
  .min(8, "密码至少 8 位")
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= 72,
    "密码最多 72 字节",
  )
  .refine((value) => value.trim() === value, "密码首尾不能有空白");

const passwordFormSchema = z
  .object({
    currentPassword: z.string(),
    password: passwordValueSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "两次输入的密码不一致",
    path: ["confirmPassword"],
  });

export async function unlinkOAuthAction(formData: FormData) {
  const user = await requireUser();
  if (user.status === "BANNED") redirect("/login?oauth=banned");
  const provider = formData.get("provider");
  if (typeof provider !== "string" || !isOAuthProvider(provider)) {
    redirect("/me?oauth=failed");
  }
  try {
    await unlinkOAuthAccount(prisma, user.id, provider);
  } catch (error) {
    redirect(
      `/me?oauth=${error instanceof OAuthError ? error.code : "failed"}`,
    );
  }
  revalidateAccount();
  redirect("/me?oauth=unlinked");
}

export async function updatePasswordAction(
  _prevState: PasswordFormState = emptyState,
  formData: FormData,
): Promise<PasswordFormState> {
  void _prevState;
  const sessionUser = await requireUser();
  if (sessionUser.status === "BANNED") {
    return { message: "该账号已被停用，请联系管理员。" };
  }

  const parsed = passwordFormSchema.safeParse({
    currentPassword:
      typeof formData.get("currentPassword") === "string"
        ? formData.get("currentPassword")
        : "",
    password:
      typeof formData.get("password") === "string"
        ? formData.get("password")
        : "",
    confirmPassword:
      typeof formData.get("confirmPassword") === "string"
        ? formData.get("confirmPassword")
        : "",
  });
  if (!parsed.success) {
    return {
      message: "请检查密码后再提交。",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: { id: true, passwordHash: true, status: true },
  });
  if (!user || user.status === "BANNED") {
    return { message: "该账号已被停用，请联系管理员。" };
  }

  if (user.passwordHash) {
    if (!parsed.data.currentPassword) {
      return {
        message: "请输入当前密码。",
        errors: { currentPassword: ["请输入当前密码。"] },
      };
    }
    const matches = await bcrypt.compare(
      parsed.data.currentPassword,
      user.passwordHash,
    );
    if (!matches) {
      return {
        message: "当前密码不正确。",
        errors: { currentPassword: ["当前密码不正确。"] },
      };
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(parsed.data.password, 12) },
  });
  revalidateAccount();
  redirect(user.passwordHash ? "/me?password=changed" : "/me?password=set");
}
