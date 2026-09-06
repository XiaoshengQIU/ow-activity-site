import { AccountPasswordForm } from "@/components/account-password-form";
import { unlinkOAuthAction } from "@/app/me/actions";
import { Card } from "@/components/ui";
import { OAuthButtons } from "@/components/oauth-buttons";
import { getOAuthAvailability } from "@/lib/oauth/server";
import { prisma } from "@/lib/prisma";

export async function OAuthConnections({ userId }: { userId: string }) {
  const [providers, linked, account] = await Promise.all([
    getOAuthAvailability(),
    prisma.oAuthAccount.findMany({
      where: { userId },
      select: { provider: true, email: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { username: true, passwordHash: true },
    }),
  ]);
  const hasPassword = Boolean(account.passwordHash);
  return (
    <Card className="gap-6 p-6">
      <div>
        <h2 className="text-lg font-semibold">账号安全</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          绑定后可用对应平台登录当前账号，资料和权限都还在。每个平台只能绑一个号，邮箱相同也不会自动合并。解绑后再用该平台直接登录会变成新账号。
        </p>
      </div>
      <OAuthButtons
        providers={providers}
        intent="link"
        linked={linked}
        hasPassword={hasPassword}
        unlinkAction={unlinkOAuthAction}
      />
      <div className="border-t border-separator pt-6">
        <AccountPasswordForm
          hasPassword={hasPassword}
          username={account.username}
        />
      </div>
    </Card>
  );
}
