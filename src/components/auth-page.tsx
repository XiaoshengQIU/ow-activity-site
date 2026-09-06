import { AuthForm } from "@/components/auth-form";
import { Card, Notice } from "@/components/ui";
import { OAuthButtons } from "@/components/oauth-buttons";
import { getOAuthAvailability } from "@/lib/oauth/server";
import { oauthMessages } from "@/lib/oauth/shared";

export async function AuthPage({
  mode,
  oauthCode,
  restored,
}: {
  mode: "login" | "register";
  oauthCode?: string;
  restored?: boolean;
}) {
  const providers = await getOAuthAvailability();
  const isLogin = mode === "login";
  return (
    <main className="page-shell auth-shell">
      <div className="auth-heading">
        <h1>{isLogin ? "登录" : "注册账号"}</h1>
        {!isLogin ? <p>账号与资料通过审核后即可报名活动。</p> : null}
      </div>
      <Card className="auth-form-card">
        {restored ? (
          <Notice tone="success">
            网站已从备份恢复。请使用备份中的管理员账号和原密码登录。
          </Notice>
        ) : null}
        {oauthCode && oauthMessages[oauthCode] ? (
          <Notice tone="warning">{oauthMessages[oauthCode]}</Notice>
        ) : null}
        <OAuthButtons
          providers={providers}
          intent={isLogin ? "login" : "register"}
        />
        <div className="flex items-center gap-3 text-sm text-muted">
          <span className="h-px flex-1 bg-separator" />
          或使用用户名和密码
          <span className="h-px flex-1 bg-separator" />
        </div>
        <AuthForm mode={mode} />
      </Card>
    </main>
  );
}
