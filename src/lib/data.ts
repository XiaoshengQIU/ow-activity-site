import "server-only";

import { cache } from "react";

import type { PlayerRole } from "@/generated/prisma/enums";
import { demoEvents, demoProfiles } from "@/lib/demo-data";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { syncEventStatuses } from "@/lib/event-schedule";

export const getHomeData = cache(async () => {
  if (!isDatabaseConfigured()) {
    return {
      events: demoEvents,
      profiles: demoProfiles,
      isDemo: true,
    };
  }

  await syncEventStatuses();
  const [events, profiles] = await Promise.all([
    prisma.event.findMany({
      where: {
        status: { in: ["OPEN", "RUNNING"] },
      },
      orderBy: { startTime: "asc" },
      take: 4,
      include: {
        registrations: {
          where: { status: "APPROVED" },
          select: { id: true },
        },
      },
    }),
    prisma.profile.findMany({
      where: {
        reviewStatus: "APPROVED",
        user: { status: "APPROVED" },
      },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: {
        id: true,
        avatarUrl: true,
        displayName: true,
        slogan: true,
        mainRole: true,
        mainHeroes: true,
      },
    }),
  ]);

  return { events, profiles, isDemo: false };
});

export const getPublicProfiles = cache(async (role?: string) => {
  if (!isDatabaseConfigured()) {
    return role
      ? demoProfiles.filter((profile) => profile.mainRole === role)
      : demoProfiles;
  }

  return prisma.profile.findMany({
    where: {
      reviewStatus: "APPROVED",
      user: { status: "APPROVED" },
      ...(role ? { mainRole: role as PlayerRole } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      avatarUrl: true,
      displayName: true,
      slogan: true,
      mainRole: true,
      mainHeroes: true,
    },
  });
});

export const getPublicEvents = cache(async () => {
  if (!isDatabaseConfigured()) {
    return demoEvents;
  }

  await syncEventStatuses();
  return prisma.event.findMany({
    where: {
      status: { not: "DRAFT" },
    },
    orderBy: { startTime: "asc" },
    include: {
      registrations: {
        where: { status: "APPROVED" },
        select: { id: true },
      },
    },
  });
});

export const getPublicEvent = cache(async (id: string) => {
  if (!isDatabaseConfigured()) {
    return demoEvents.find((event) => event.id === id) ?? null;
  }

  await syncEventStatuses();
  return prisma.event.findFirst({
    where: {
      id,
      status: { not: "DRAFT" },
    },
    include: {
      registrations: {
        where: { status: "APPROVED" },
        select: {
          id: true,
          preferredRole: true,
          user: {
            select: {
              profile: {
                select: {
                  displayName: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      },
    },
  });
});
