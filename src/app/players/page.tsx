import { Search } from "lucide-react";
import { buttonVariants } from "@heroui/react";
import Link from "next/link";
import { PlayerCard } from "@/components/profile-card";
import { EmptyState, PageHeading } from "@/components/page-heading";
import { Button, ButtonLink, InputField } from "@/components/ui";
import { getPublicProfiles } from "@/lib/data";
import { roleLabels } from "@/lib/format";

export const dynamic = "force-dynamic";
export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string }>;
}) {
  const query = await searchParams;
  const role =
    query.role && Object.hasOwn(roleLabels, query.role) ? query.role : "all";
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 100) : "";
  // 位置筛选交给数据库，页面只在结果里做文字匹配。
  const allProfiles = await getPublicProfiles(role === "all" ? undefined : role);
  const profiles = allProfiles.filter(
    (profile) =>
      !q ||
      `${profile.displayName} ${profile.slogan} ${profile.mainHeroes.join(" ")}`
        .toLowerCase()
        .includes(q.toLowerCase()),
  );
  return (
    <main className="page-shell">
      <PageHeading title="玩家" />
      <div className="directory-toolbar">
        <nav aria-label="玩家位置筛选" className="directory-filters">
          {Object.entries({ all: "全部位置", ...roleLabels }).map(
            ([value, label]) => {
              const params = new URLSearchParams();
              if (value !== "all") params.set("role", value);
              if (q) params.set("q", q);
              return (
                <Link
                  key={value}
                  href={`/players${params.size ? "?" + params.toString() : ""}`}
                  aria-current={role === value ? "page" : undefined}
                  className={buttonVariants({
                    variant: role === value ? "secondary" : "ghost",
                  })}
                >
                  {label}
                </Link>
              );
            },
          )}
        </nav>
        <form action="/players" method="get" className="directory-search">
          <input type="hidden" name="role" value={role} />
          <InputField
            key={q}
            label="搜索玩家"
            name="q"
            defaultValue={q}
            placeholder="昵称、常用英雄…"
            maxLength={100}
          />
          <Button type="submit" variant="secondary" aria-label="搜索玩家">
            <Search size={17} />
          </Button>
        </form>
      </div>
      {profiles.length ? (
        <div className="player-grid">
          {profiles.map((profile) => (
            <PlayerCard key={profile.id} profile={profile} />
          ))}
        </div>
      ) : (
        <EmptyState
          title={q || role !== "all" ? "没有匹配的玩家" : "暂无玩家"}
          description={
            q || role !== "all"
              ? "试试其他关键词或位置。"
              : "资料通过审核后会公开展示。"
          }
          action={
            <ButtonLink
              href={q || role !== "all" ? "/players" : "/me"}
              variant="secondary"
            >
              {q || role !== "all" ? "查看全部玩家" : "创建我的玩家卡片"}
            </ButtonLink>
          }
        />
      )}
    </main>
  );
}
