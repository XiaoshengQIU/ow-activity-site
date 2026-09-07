import Link from "next/link";
import { Card, StatusChip } from "@/components/ui";
import { SiteCover } from "@/components/site-content";
import { eventStatusLabels, eventTypeLabel } from "@/lib/format";
import { formatEventMoment, scheduledEventStatus } from "@/lib/event-date";
export type EventCardProps = {
  event: {
    id: string;
    title: string;
    description: string;
    coverUrl?: string | null;
    type: string;
    customType?: string | null;
    status: string;
    startTime: Date;
    signupDeadline?: Date | null;
    maxParticipants: number;
    registrations?: readonly { id: string }[];
  };
  hrefPrefix?: string;
  variant?: "default" | "featured" | "compact";
};
export function EventCard({
  event,
  hrefPrefix = "/events",
  variant = "default",
}: EventCardProps) {
  const href = hrefPrefix + "/" + event.id;
  // 状态列由定时任务和读取时的同步维护，但显示不该依赖它跑没跑过：
  // 这里按开始时间和报名截止时间当场判断，过期活动不会再标成报名中。
  const status = scheduledEventStatus(
    {
      status: event.status as Parameters<typeof scheduledEventStatus>[0]["status"],
      startTime: event.startTime,
      signupDeadline: event.signupDeadline ?? null,
    },
  );
  return (
    <Card
      className={`event-card event-card--${variant} cover-glass-card`}
      data-type={event.type}
    >
      <Link
        href={href}
        className="event-card-image cover-glass-image"
        tabIndex={-1}
        aria-hidden="true"
      >
        <SiteCover src={event.coverUrl} alt="" />
        {/* 没有封面时顶上来的装饰图块，CSS 在有 img 时隐藏它。 */}
        <span className="card-tile" data-type={event.type}>
          <span className="card-tile-glyph">{eventTypeLabel(event)}</span>
        </span>
      </Link>
      <div className="event-card-copy cover-glass-panel">
        <div className="event-card-header">
          <span className="event-card-type">{eventTypeLabel(event)}</span>
          <StatusChip
            status={status}
            label={
              eventStatusLabels[status as keyof typeof eventStatusLabels] ??
              status
            }
          />
        </div>
        <div className="event-card-body">
          <div className="flex-1">
            <h3 className="event-card-title">
              <Link href={href}>{event.title}</Link>
            </h3>
            {variant === "compact" ? null : (
              <p className="event-card-description mt-2 line-clamp-2 text-sm leading-6">
                {event.description}
              </p>
            )}
          </div>
          <div className="event-card-footer">
            <div className="event-card-times">
              <time dateTime={event.startTime.toISOString()}>
                活动 {formatEventMoment(event.startTime)}
              </time>
              {event.signupDeadline ? (
                <time dateTime={event.signupDeadline.toISOString()}>
                  报名截止 {formatEventMoment(event.signupDeadline)}
                </time>
              ) : null}
            </div>
            <span className="event-card-count">
              {event.registrations?.length ?? 0} / {event.maxParticipants} 人
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
