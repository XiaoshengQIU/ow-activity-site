import { hasPermission } from "@/lib/admin-permissions";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  checkForUpdates,
  loadUpdateCommits,
  requestDeployment,
} from "@/lib/updates/service";
import { UpdateError } from "@/lib/updates/shared";
import { z } from "zod";
import { shaSchema } from "@/lib/updates/github";
import { isSameSitePost } from "@/lib/oauth/request-origin";
import { oauthOrigin } from "@/lib/oauth/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
async function denied() {
  const user = await getCurrentUser();
  return !user
    ? json({ message: "请先登录。" }, 401)
    : !hasPermission(user, "updates")
      ? json({ message: "没有版本更新权限。" }, 403)
      : null;
}
export async function GET(request: Request) {
  const failure = await denied();
  if (failure) return failure;
  try {
    const params = new URL(request.url).searchParams;
    if (params.has("page"))
      return json({
        commits: await loadUpdateCommits(
          prisma,
          process.env.APP_BUILD_COMMIT || "",
          params.get("sha") || "",
          Number(params.get("revision")),
          Number(params.get("page")),
        ),
      });
    return json(
      await checkForUpdates(
        prisma,
        process.env.APP_BUILD_COMMIT || "",
        process.env.OAUTH_ENCRYPTION_KEY,
        params.get("force") === "1",
      ),
    );
  } catch (error) {
    return json(
      {
        message:
          error instanceof UpdateError
            ? error.message
            : "检查失败，请稍后重试。",
      },
      400,
    );
  }
}
export async function POST(request: Request) {
  const failure = await denied();
  if (failure) return failure;
  const origin = oauthOrigin(request.url);
  if (!isSameSitePost(request, origin))
    return json({ message: "请求来源不正确。" }, 403);
  const input = z
    .object({ sha: shaSchema, revision: z.number().int().nonnegative() })
    .safeParse(await request.json().catch(() => null));
  if (!input.success) return json({ message: "更新请求不正确。" }, 400);
  try {
    return json(
      await requestDeployment(
        prisma,
        process.env.APP_BUILD_COMMIT || "",
        input.data.sha,
        input.data.revision,
        process.env.OAUTH_ENCRYPTION_KEY,
      ),
    );
  } catch (error) {
    return json(
      {
        message:
          error instanceof UpdateError
            ? error.message
            : "提交部署失败，请稍后重试。",
      },
      400,
    );
  }
}
