import Link from "next/link";
import { Card, StatusChip } from "@/components/ui";
import { SiteCover } from "@/components/site-content";
import { eventStatusLabels, eventTypeLabel } from "@/lib/format";
import { formatEventDate, shanghaiDateValue } from "@/lib/event-date";
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
            status={event.status}
            label={
              eventStatusLabels[
                event.status as keyof typeof eventStatusLabels
              ] ?? event.status
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
            <time dateTime={shanghaiDateValue(event.startTime)}>
              {formatEventDate(event.startTime)}
            </time>
            <span>
              {event.registrations?.length ?? 0} / {event.maxParticipants} 人
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
