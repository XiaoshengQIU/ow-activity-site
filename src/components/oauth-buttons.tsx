"use client";
import { ActionButton } from "@/components/action-button";
import { Button } from "@/components/ui";
import {
  canUnlinkOAuth,
  oauthNames,
  type OAuthAvailability,
  type OAuthEntry,
  type OAuthProvider,
} from "@/lib/oauth/shared";

export function GoogleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[18px] shrink-0"
      aria-hidden="true"
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.73-.06-1.42-.19-2.09H12v3.96h5.92a5.07 5.07 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.75 3.28-7.95Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.8l-3.56-2.76c-.99.66-2.25 1.06-3.72 1.06-2.87 0-5.3-1.94-6.17-4.54H2.15v2.85A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.83 13.96a6.6 6.6 0 0 1 0-3.92V7.19H2.15a11 11 0 0 0 0 9.62l3.68-2.85Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.5c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.54 10.54 0 0 0 12 1a11 11 0 0 0-9.85 6.19l3.68 2.85C6.7 7.44 9.13 5.5 12 5.5Z"
      />
    </svg>
  );
}

// GitHub mark from Primer Octicons (MIT), see THIRD_PARTY_NOTICES.md.
function GithubIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-[18px] shrink-0"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656" />
    </svg>
  );
}
export function OAuthButtons({
  providers,
  intent = "login",
  linked = [],
  hasPassword = false,
  unlinkAction,
}: {
  providers: OAuthAvailability[];
  intent?: OAuthEntry;
  linked?: { provider: OAuthProvider; email: string | null }[];
  hasPassword?: boolean;
  unlinkAction?: (formData: FormData) => void | Promise<void>;
}) {
  const canUnlink = canUnlinkOAuth(hasPassword, linked.length);
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {providers.map(({ provider, available }) => {
          const account = linked.find((item) => item.provider === provider);
          const bindDisabled = !available || Boolean(account);
          return (
            <div key={provider} className="min-w-0">
              {account && unlinkAction ? (
                <form action={unlinkAction}>
                  <input type="hidden" name="provider" value={provider} />
                  <ActionButton
                    variant="secondary"
                    className="w-full gap-2"
                    isDisabled={!canUnlink}
                    pendingLabel="解绑中…"
                  >
                    {provider === "google" ? <GoogleIcon /> : <GithubIcon />}
                    解除 {oauthNames[provider]} 绑定
                  </ActionButton>
                </form>
              ) : (
                <form method="post" action={`/api/auth/${provider}`}>
                  <input type="hidden" name="intent" value={intent} />
                  <Button
                    type="submit"
                    variant="secondary"
                    isDisabled={bindDisabled}
                    className={`w-full gap-2 ${bindDisabled ? "grayscale opacity-50" : ""}`}
                  >
                    {provider === "google" ? <GoogleIcon /> : <GithubIcon />}
                    {intent === "link"
                      ? `绑定 ${oauthNames[provider]}`
                      : `使用 ${oauthNames[provider]} 登录`}
                  </Button>
                </form>
              )}
              {account?.email ? (
                <p className="mt-2 break-all text-xs text-muted">
                  {account.email}
                </p>
              ) : account ? (
                <p className="mt-2 text-xs text-muted">已绑定，平台未提供邮箱</p>
              ) : null}
            </div>
          );
        })}
      </div>
      {intent === "link" && linked.length > 0 && !canUnlink ? (
        <p className="text-xs leading-6 text-muted">
          这是目前唯一的登录方式。请先设置密码，或再绑定另一个平台后再解绑。
        </p>
      ) : null}
      {providers.some((item) => !item.available) ? (
        <p className="text-xs leading-6 text-muted">
          灰色按钮表示该登录方式暂未开放。
        </p>
      ) : null}
    </div>
  );
}
