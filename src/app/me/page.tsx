import Link from "next/link";
import { updateProfileAction } from "@/app/actions";
import { ImageFileField } from "@/components/image-file-field";
import { MAX_AVATAR_BYTES } from "@/lib/avatar-upload";
import { ActionButton } from "@/components/action-button";
import { Avatar } from "@/components/avatar";
import { PageHeading } from "@/components/page-heading";
import {
  ButtonLink,
  Card,
  CheckField,
  InputField,
  Notice,
  SelectField,
  StatusChip,
  TextAreaField,
} from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { OAuthConnections } from "@/components/oauth-connections";
import { oauthMessages } from "@/lib/oauth/shared";
import {
  registrationStatusLabels,
  reviewLabels,
  roleLabels,
  userStatusLabels,
} from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { formatEventDate } from "@/lib/event-date";

export const dynamic = "force-dynamic";
export default async function MePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, query] = await Promise.all([
    requireUser(),
    searchParams ??
      Promise.resolve<Record<string, string | string[] | undefined>>({}),
  ]);
  const [profile, registrations] = await Promise.all([
    prisma.profile.findUnique({ where: { userId: user.id } }),
    prisma.eventRegistration.findMany({
      where: {
        userId: user.id,
        status: { not: "CANCELLED" },
        event: { status: { not: "DRAFT" } },
      },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        status: true,
        event: { select: { id: true, title: true, startTime: true } },
      },
    }),
  ]);
  const errors: Record<string, string> = {
    "avatar-size": "头像不能超过 512 KB。",
    "avatar-type": "头像只支持 PNG、JPEG、WebP 或 GIF。",
    profile: "资料格式有误，请检查后重新提交。",
    banned: "该账号已被停用，无法修改资料。请联系管理员。",
  };
  const error =
    typeof query.error === "string" ? errors[query.error] : undefined;
  return (
    <main className="page-shell">
      <PageHeading title="个人中心" />
      {typeof query.oauth === "string" && oauthMessages[query.oauth] ? (
        <div className="mb-5">
          <Notice
            tone={
              query.oauth === "linked" || query.oauth === "unlinked"
                ? "success"
                : "warning"
            }
          >
            {oauthMessages[query.oauth]}
          </Notice>
        </div>
      ) : null}
      {query.password === "set" || query.password === "changed" ? (
        <div className="mb-5">
          <Notice tone="success">
            {query.password === "set"
              ? "密码已设置，之后可以用用户名和密码登录。"
              : "密码已更新。"}
          </Notice>
        </div>
      ) : null}
      <nav className="profile-section-nav" aria-label="个人中心分区">
        <Link href="#public-profile">公开资料</Link>
        <Link href="#private-profile">私密资料</Link>
        <Link href="#my-activities">我的报名</Link>
        <Link href="#account-security">账号安全</Link>
      </nav>
      <div className="profile-layout">
        <aside className="grid gap-4">
          <Card className="profile-summary gap-5 p-6">
            <Avatar
              src={profile?.avatarUrl}
              name={profile?.displayName ?? user.username}
              size="lg"
            />
            <div>
              <h2 className="break-words text-xl font-semibold">
                {profile?.displayName ?? user.username}
              </h2>
              <p className="mt-1 text-sm text-muted">@{user.username}</p>
            </div>
            {profile?.slogan ? (
              <p className="text-sm leading-6 text-muted">{profile.slogan}</p>
            ) : null}
            <div className="grid gap-3 border-t border-separator pt-5">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted">账号状态</span>
                <StatusChip
                  status={user.status}
                  label={userStatusLabels[user.status]}
                />
              </div>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted">资料审核</span>
                <StatusChip
                  status={profile?.reviewStatus ?? "PENDING"}
                  label={
                    profile ? reviewLabels[profile.reviewStatus] : "未填写"
                  }
                />
              </div>
            </div>
            <ButtonLink href="/events" variant="secondary" className="w-full">
              查看活动
            </ButtonLink>
          </Card>
          {user.role !== "ADMIN" ? (
            <Notice>
              公开资料修改后需重新审核。账号与资料均通过审核后即可报名。
            </Notice>
          ) : null}
          {profile?.reviewNote ? (
            <Notice tone="warning">审核备注：{profile.reviewNote}</Notice>
          ) : null}
          <Card id="my-activities" className="gap-4 p-5">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">我的报名</h2>
            </div>
            {registrations.length ? (
              <div className="grid gap-4">
                {registrations.map((registration) => (
                  <Link
                    key={registration.id}
                    href={`/events/${registration.event.id}`}
                    className="grid gap-2 border-t border-separator pt-4"
                  >
                    <span className="flex items-start justify-between gap-2 text-sm font-medium">
                      {registration.event.title}
                    </span>
                    <span className="text-sm text-muted">
                      {formatEventDate(registration.event.startTime)}
                    </span>
                    <StatusChip
                      status={registration.status}
                      label={registrationStatusLabels[registration.status]}
                    />
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">暂无报名记录。</p>
            )}
          </Card>
        </aside>
        <div className="grid min-w-0 gap-4">
          {query.registered === "1" ? (
            <Notice tone="success">
              注册成功！请完善资料，等待管理员审核。
            </Notice>
          ) : null}
          {query.saved === "profile" ? (
            <Notice tone="success">
              {user.role === "ADMIN"
                ? "资料已保存。"
                : "资料已保存，请等待管理员审核。"}
            </Notice>
          ) : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Card className="p-6 sm:p-8">
            <form action={updateProfileAction} className="grid gap-8">
              <fieldset className="form-section" id="public-profile">
                <legend>公开资料</legend>
                <div className="grid gap-5 md:grid-cols-2">
                  <InputField
                    label="公开昵称"
                    name="displayName"
                    required
                    minLength={2}
                    maxLength={20}
                    defaultValue={profile?.displayName ?? ""}
                  />
                  <SelectField
                    label="常用位置"
                    name="mainRole"
                    defaultValue={profile?.mainRole ?? ""}
                    options={{ "": "暂不选择", ...roleLabels }}
                  />
                  <ImageFileField
                    label="上传头像"
                    name="avatarFile"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    limit={MAX_AVATAR_BYTES}
                    description="PNG、JPEG、WebP 或 GIF；过大的图片会自动压缩。"
                  />
                  <InputField
                    label="或使用头像链接"
                    name="avatarUrl"
                    type="url"
                    defaultValue={
                      profile?.avatarUrl?.startsWith("http")
                        ? profile.avatarUrl
                        : ""
                    }
                    placeholder="https://…"
                  />
                </div>
                {profile?.avatarUrl ? (
                  <CheckField name="removeAvatar">删除当前头像</CheckField>
                ) : null}
                <InputField
                  label="常用英雄"
                  name="mainHeroes"
                  defaultValue={profile?.mainHeroes.join("，") ?? ""}
                  placeholder="安娜，源氏，莱因哈特"
                  description="多个英雄用逗号分隔。"
                />
                <TextAreaField
                  label="公开宣言"
                  name="slogan"
                  required
                  maxLength={80}
                  defaultValue={profile?.slogan ?? ""}
                  description="最多 80 字。"
                />
              </fieldset>
              <fieldset
                className="form-section border-t border-separator pt-7"
                id="private-profile"
              >
                <legend>私密资料</legend>
                <p className="text-sm leading-6 text-muted">
                  仅你和管理员可见，用于安排活动与联系。
                </p>
                <div className="grid gap-5 md:grid-cols-2">
                  <InputField
                    label="战网 ID"
                    name="battleTag"
                    defaultValue={profile?.battleTag ?? ""}
                    placeholder="昵称#1234"
                  />
                  <InputField
                    label="段位"
                    name="rank"
                    defaultValue={profile?.rank ?? ""}
                    placeholder="填写你的当前段位"
                  />
                  <InputField
                    label="常在线时间"
                    name="onlineTime"
                    defaultValue={profile?.onlineTime ?? ""}
                    placeholder="周五、周六晚上"
                  />
                  <InputField
                    label="联系方式"
                    name="contact"
                    defaultValue={profile?.contact ?? ""}
                    placeholder="QQ / 微信 / Discord，可留空"
                  />
                </div>
                <TextAreaField
                  label="补充备注"
                  name="extraNote"
                  maxLength={300}
                  defaultValue={profile?.extraNote ?? ""}
                  placeholder="还有什么想告诉管理员的？"
                />
              </fieldset>
              <div className="flex justify-end border-t border-separator pt-5">
                <ActionButton pendingLabel="保存中…">保存资料</ActionButton>
              </div>
            </form>
          </Card>
          <section id="account-security">
            <OAuthConnections userId={user.id} />
          </section>
        </div>
      </div>
    </main>
  );
}
