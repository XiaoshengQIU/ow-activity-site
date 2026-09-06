import { prisma } from "@/lib/prisma";
import { createChatCompletion } from "./openai-compatible";
import { applyProfileReview } from "@/lib/profile-review";
import {
  buildReviewPrompt,
  buildReviewUserMessage,
  parseReviewResponse,
} from "./review-text";
import { getAiSettings, runtimeAiSettings } from "./settings";

export {
  buildReviewPrompt,
  buildReviewUserMessage,
  parseReviewResponse,
} from "./review-text";

export async function maybeAutoReviewByUserId(userId: string) {
  try {
    const profile = await prisma.profile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (profile) await maybeAutoReviewProfile(profile.id);
  } catch {
    // Registration already succeeded; leave the profile pending.
  }
}

export async function maybeAutoReviewProfile(profileId: string) {
  try {
    const settings = runtimeAiSettings(
      await getAiSettings(prisma),
      process.env.OAUTH_ENCRYPTION_KEY,
    );
    if (!settings?.autoReview) return;
    const profile = await prisma.profile.findUnique({
      where: { id: profileId },
      include: { user: { select: { role: true, status: true } } },
    });
    if (
      !profile ||
      profile.reviewStatus !== "PENDING" ||
      profile.user.role === "ADMIN" ||
      profile.user.status === "BANNED"
    )
      return;
    const origin =
      process.env.SITE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL
        : "http://localhost:3000");
    const raw = await createChatCompletion({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      origin,
      model: settings.model,
      messages: [
        { role: "system", content: buildReviewPrompt() },
        {
          role: "user",
          content: buildReviewUserMessage({
            ...profile,
            // Prisma 的行里只有 avatarUrl，不补这一步 hasAvatar 恒为 false。
            hasAvatar: Boolean(profile.avatarUrl),
          }),
        },
      ],
    });
    const result = parseReviewResponse(raw);
    if (result.decision === "PENDING") return;
    await applyProfileReview({
      profileId,
      decision: result.decision,
      note: (result.note || "AI 已完成资料审核。") + "（AI 自动审核）",
      reviewerId: null,
    });
  } catch {
    // Keep the profile pending so a person can still review it.
  }
}
