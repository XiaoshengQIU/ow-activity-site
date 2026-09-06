import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createSession, getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  consumeOAuthState,
  finishOAuthAccount,
  OAuthError,
} from "@/lib/oauth/accounts";
import { callbackPath } from "@/lib/oauth/config";
import { exchangeIdentity } from "@/lib/oauth/providers";
import {
  hashToken,
  readFlow,
  sameToken,
  type OAuthFlow,
} from "@/lib/oauth/security";
import {
  flowCookieName,
  getRuntimeOAuthConfig,
  oauthOrigin,
} from "@/lib/oauth/server";
import { isOAuthProvider, oauthReturnPath } from "@/lib/oauth/shared";
import { matchesSiteRequest } from "@/lib/oauth/request-origin";

export const dynamic = "force-dynamic";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!isOAuthProvider(provider))
    return new Response("Not found", { status: 404 });
  const origin = oauthOrigin(request.url);
  const cookieStore = await cookies();
  const respond = (path: string) => {
    const response = NextResponse.redirect(origin + path, 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.cookies.set(flowCookieName(provider), "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return response;
  };
  let flow: OAuthFlow | undefined;
  try {
    flow = readFlow(
      cookieStore.get(flowCookieName(provider))?.value ?? "",
      provider,
      request.nextUrl.searchParams.get("state") ?? "",
      process.env.OAUTH_ENCRYPTION_KEY,
    );
    if (
      !matchesSiteRequest(request, origin) ||
      flow.callbackUrl !== origin + callbackPath(provider)
    )
      throw new OAuthError("expired");
    await consumeOAuthState(prisma, flow);
  } catch {
    const loggedIn = Boolean(await getCurrentUser());
    const path =
      flow?.linkUserId || flow?.entry === "link" || loggedIn
        ? "/me"
        : oauthReturnPath(flow?.entry);
    return respond(`${path}?oauth=expired`);
  }
  const failurePath = flow.linkUserId
    ? "/me"
    : oauthReturnPath(flow.entry);
  if (request.nextUrl.searchParams.has("error"))
    return respond(`${failurePath}?oauth=cancelled`);
  try {
    const config = await getRuntimeOAuthConfig(provider);
    if (!config || config.revision !== flow.revision)
      throw new OAuthError("disabled");
    if (flow.linkUserId) {
      const user = await getCurrentUser();
      const session = cookieStore.get(SESSION_COOKIE)?.value;
      if (
        user?.id !== flow.linkUserId ||
        !session ||
        !flow.linkSessionHash ||
        !sameToken(hashToken(session), flow.linkSessionHash)
      )
        throw new OAuthError("session");
    }
    const code = request.nextUrl.searchParams.get("code");
    if (!code || code.length > 4096) throw new OAuthError("expired");
    const identity = await exchangeIdentity(config, flow, code);
    const result = await finishOAuthAccount(
      prisma,
      provider,
      config.revision,
      identity,
      flow.linkUserId,
    );
    if (flow.linkUserId) return respond("/me?oauth=linked");
    await createSession(result.user.id);
    if (result.created && result.user.role !== "ADMIN") {
      const { maybeAutoReviewByUserId } = await import("@/lib/ai/review");
      await maybeAutoReviewByUserId(result.user.id);
    }
    return respond(
      result.user.role === "ADMIN"
        ? "/admin"
        : result.created
          ? "/me?registered=1"
          : "/me",
    );
  } catch (error) {
    return respond(
      `${failurePath}?oauth=${error instanceof OAuthError ? error.code : "failed"}`,
    );
  }
}
