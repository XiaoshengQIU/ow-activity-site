import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { callbackPath } from "@/lib/oauth/config";
import { authorizationUrl } from "@/lib/oauth/providers";
import {
  hashToken,
  OAUTH_LIFETIME_SECONDS,
  randomToken,
  seal,
  type OAuthFlow,
} from "@/lib/oauth/security";
import {
  flowCookieName,
  getRuntimeOAuthConfig,
  oauthOrigin,
} from "@/lib/oauth/server";
import {
  isOAuthProvider,
  oauthEntryFromIntent,
  oauthReturnPath,
} from "@/lib/oauth/shared";
import { matchesSiteRequest } from "@/lib/oauth/request-origin";

export const dynamic = "force-dynamic";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!isOAuthProvider(provider))
    return new Response("Not found", { status: 404 });
  const origin = oauthOrigin(request.url);
  if (
    request.headers.get("origin") !== origin ||
    !matchesSiteRequest(request, origin)
  )
    return new Response("Forbidden", { status: 403 });
  let entry = oauthEntryFromIntent(null);
  const fail = (code: string) =>
    NextResponse.redirect(`${origin}${oauthReturnPath(entry)}?oauth=${code}`, 303);
  try {
    const form = await request.formData();
    entry = oauthEntryFromIntent(form.get("intent"));
    const linking = entry === "link";
    const config = await getRuntimeOAuthConfig(provider);
    if (!config) return fail("disabled");
    const user = linking ? await getCurrentUser() : null;
    const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
    if (linking && (!user || user.status === "BANNED" || !sessionToken))
      return fail("session");
    const flow: OAuthFlow = {
      provider,
      state: randomToken(),
      verifier: randomToken(),
      nonce: randomToken(),
      expiresAt: Date.now() + OAUTH_LIFETIME_SECONDS * 1000,
      revision: config.revision,
      callbackUrl: origin + callbackPath(provider),
      linkUserId: user?.id ?? null,
      linkSessionHash: linking && sessionToken ? hashToken(sessionToken) : null,
      entry,
    };
    await prisma.oAuthState.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
    await prisma.oAuthState.create({
      data: {
        stateHash: hashToken(flow.state),
        provider,
        expiresAt: new Date(flow.expiresAt),
      },
    });
    const response = NextResponse.redirect(authorizationUrl(config, flow), 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.cookies.set(
      flowCookieName(provider),
      seal(
        JSON.stringify(flow),
        `oauth-flow:${provider}`,
        process.env.OAUTH_ENCRYPTION_KEY,
      ),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: OAUTH_LIFETIME_SECONDS,
      },
    );
    return response;
  } catch {
    return fail("failed");
  }
}
