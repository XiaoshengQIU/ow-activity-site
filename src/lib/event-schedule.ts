import "server-only";
import { cache } from "react";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { shanghaiDayBounds } from "@/lib/event-date";

const EMPTY = { finished: 0, running: 0, closed: 0 };

// 只有真正过期的行才需要写。读取页面几乎总是靠下面这条索引查询就返回，
// 不必每次导航都开一个写事务。
function staleEvents(today: Date, tomorrow: Date, now: Date) {
  const outdated: Prisma.EventWhereInput = {
    status: { in: ["OPEN", "CLOSED", "RUNNING"] },
    startTime: { lt: today },
  };
  const started: Prisma.EventWhereInput = {
    status: { in: ["OPEN", "CLOSED", "FINISHED"] },
    startTime: { gte: today, lt: tomorrow },
  };
  const expired: Prisma.EventWhereInput = {
    status: "OPEN",
    startTime: { gte: tomorrow },
    signupDeadline: { lt: now },
  };
  return { outdated, started, expired };
}

// 同一请求只同步一次；定时任务和读取页面使用相同的上海日期边界。
export const syncEventStatuses = cache(async (now = new Date()) => {
  if (!isDatabaseConfigured()) return EMPTY;
  const { today, tomorrow } = shanghaiDayBounds(now);
  const { outdated, started, expired } = staleEvents(today, tomorrow, now);

  const pending = await prisma.event.findFirst({
    where: { OR: [outdated, started, expired] },
    select: { id: true },
  });
  if (!pending) return EMPTY;

  const [finished, running, closed] = await prisma.$transaction([
    prisma.event.updateMany({ where: outdated, data: { status: "FINISHED" } }),
    prisma.event.updateMany({ where: started, data: { status: "RUNNING" } }),
    prisma.event.updateMany({ where: expired, data: { status: "CLOSED" } }),
  ]);
  return {
    finished: finished.count,
    running: running.count,
    closed: closed.count,
  };
});
