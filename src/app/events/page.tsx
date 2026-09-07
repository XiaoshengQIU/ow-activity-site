import { Search } from "lucide-react";
import { buttonVariants } from "@heroui/react";
import Link from "next/link";
import { EventCard } from "@/components/event-card";
import { EmptyState, PageHeading } from "@/components/page-heading";
import { Button, ButtonLink, InputField } from "@/components/ui";
import { getPublicEvents } from "@/lib/data";
import { eventTypeLabel } from "@/lib/format";
import { scheduledEventStatus } from "@/lib/event-date";

export const dynamic = "force-dynamic";
const filters = [
  { id: "all", label: "全部活动" },
  { id: "OPEN", label: "报名中" },
  { id: "RUNNING", label: "进行中" },
  { id: "CLOSED", label: "已截止" },
  { id: "FINISHED", label: "已结束" },
];
export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const [allEvents, query] = await Promise.all([
    getPublicEvents(),
    searchParams,
  ]);
  const status = filters.some((item) => item.id === query.status)
    ? query.status!
    : "all";
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 100) : "";
  // CLOSED 原本不在这张表里，落到默认值后排在 CANCELLED 之后，
  // 于是"报名已截止但还没开始"的活动被挤到已结束的旧活动下面。
  const order: Record<string, number> = {
    RUNNING: 0,
    OPEN: 1,
    CLOSED: 2,
    FINISHED: 3,
    CANCELLED: 4,
  };
  const isPast = (value: string) =>
    value === "FINISHED" || value === "CANCELLED";
  // 状态按当前时间当场判断，不依赖同步任务是否跑过。
  const events = allEvents
    .map((event) => ({ ...event, status: scheduledEventStatus(event) }))
    .filter(
      (event) =>
        (status === "all" || event.status === status) &&
        (!q ||
          `${event.title} ${event.description} ${eventTypeLabel(event)}`
            .toLowerCase()
            .includes(q.toLowerCase())),
    )
    .sort(
      (a, b) =>
        (order[a.status] ?? 5) - (order[b.status] ?? 5) ||
        // 未开始的按时间正序，已过去的按时间倒序，都是先近后远。
        (isPast(a.status)
          ? b.startTime.getTime() - a.startTime.getTime()
          : a.startTime.getTime() - b.startTime.getTime()),
    );
  return (
    <main className="page-shell">
      <PageHeading title="活动" />
      <div className="directory-toolbar">
        <nav aria-label="活动状态筛选" className="directory-filters">
          {filters.map((filter) => {
            const params = new URLSearchParams();
            if (filter.id !== "all") params.set("status", filter.id);
            if (q) params.set("q", q);
            return (
              <Link
                key={filter.id}
                href={`/events${params.size ? "?" + params.toString() : ""}`}
                aria-current={filter.id === status ? "page" : undefined}
                className={buttonVariants({
                  variant: filter.id === status ? "secondary" : "ghost",
                })}
              >
                {filter.label}
              </Link>
            );
          })}
        </nav>
        <form action="/events" method="get" className="directory-search">
          <input type="hidden" name="status" value={status} />
          <InputField
            key={q}
            label="搜索活动"
            name="q"
            defaultValue={q}
            placeholder="活动名称、玩法…"
            maxLength={100}
          />
          <Button type="submit" variant="secondary" aria-label="搜索活动">
            <Search size={17} />
          </Button>
        </form>
      </div>
      {events.length ? (
        <div className="event-grid">
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      ) : (
        <EmptyState
          title={q || status !== "all" ? "没有匹配的活动" : "暂无活动"}
          description={
            q || status !== "all" ? "试试其他关键词或分类。" : undefined
          }
          action={
            q || status !== "all" ? (
              <ButtonLink href="/events" variant="secondary">
                查看全部活动
              </ButtonLink>
            ) : undefined
          }
        />
      )}
    </main>
  );
}
