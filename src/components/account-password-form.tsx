"use client";

import { useActionState } from "react";
import {
  updatePasswordAction,
  type PasswordFormState,
} from "@/app/me/actions";
import { ActionButton } from "@/components/action-button";
import { InputField, Notice } from "@/components/ui";

const initialState: PasswordFormState = { message: "" };

export function AccountPasswordForm({
  hasPassword,
  username,
}: {
  hasPassword: boolean;
  username: string;
}) {
  const [state, action] = useActionState(updatePasswordAction, initialState);
  return (
    <form action={action} className="grid gap-5">
      <div>
        <h3 className="font-medium">
          {hasPassword ? "修改密码" : "设置密码"}
        </h3>
        <p className="mt-2 text-sm leading-6 text-muted">
          {hasPassword
            ? `用户名是 ${username}。改完后仍可用原用户名登录。`
            : `这个账号还没有密码。设好后可以用用户名 ${username} 登录，也可以再解绑第三方账号。`}
        </p>
      </div>
      {hasPassword ? (
        <InputField
          label="当前密码"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          error={state.errors?.currentPassword?.[0]}
        />
      ) : null}
      <InputField
        label={hasPassword ? "新密码" : "密码"}
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        maxLength={72}
        required
        description="至少 8 位，首尾不能有空格。"
        error={state.errors?.password?.[0]}
      />
      <InputField
        label="确认密码"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        minLength={8}
        maxLength={72}
        required
        error={state.errors?.confirmPassword?.[0]}
      />
      {state.message ? <Notice tone="danger">{state.message}</Notice> : null}
      <div className="flex justify-end">
        <ActionButton pendingLabel="保存中…">
          {hasPassword ? "更新密码" : "设置密码"}
        </ActionButton>
      </div>
    </form>
  );
}