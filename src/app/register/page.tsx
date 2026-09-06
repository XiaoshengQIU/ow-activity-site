import { AuthPage } from "@/components/auth-page";
import { redirectIfAdminSetupOpen } from "@/lib/auth";
import { getOAuthAvailability } from "@/lib/oauth/server";
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, query] = await Promise.all([
    redirectIfAdminSetupOpen(),
    searchParams,
    getOAuthAvailability(),
  ]);
  return (
    <AuthPage
      mode="register"
      oauthCode={typeof query.oauth === "string" ? query.oauth : undefined}
    />
  );
}
