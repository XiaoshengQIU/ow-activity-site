import { DAY_MS, parseShanghaiDate, shanghaiDateValue } from "@/lib/event-date";
const today = parseShanghaiDate(shanghaiDateValue())!;
const weekday = new Date(today.getTime() + 8 * 3_600_000).getUTCDay();
const nextSaturday = new Date(
  today.getTime() + ((6 - weekday + 7) % 7 || 7) * DAY_MS,
);
const nextFriday = new Date(nextSaturday.getTime() - 1);

export const demoEvents = [
  {
    id: "demo-weekend-scrim",
    coverUrl: "",
    title: "周末内战",
    description: "轻松组队，按报名位置做基础平衡，优先照顾能全程语音的玩家。",
    type: "SCRIM",
    customType: null,
    signupClosed: false,
    status: "OPEN",
    startTime: nextSaturday,
    signupDeadline: nextFriday,
    maxParticipants: 12,
    requirements: "资料审核通过后可报名。",
    voiceChannel: "活动开始前由管理员通知。",
    registrations: [{ id: "r1" }, { id: "r2" }, { id: "r3" }],
  },
  {
    id: "demo-custom-night",
    coverUrl: "",
    title: "自定义娱乐房",
    description: "快速模式规则混合英雄限制，适合新朋友一起熟悉队伍节奏。",
    type: "CUSTOM",
    customType: "英雄挑战",
    signupClosed: false,
    status: "OPEN",
    startTime: new Date(nextSaturday.getTime() + 1000 * 60 * 60 * 24 * 3),
    signupDeadline: new Date(nextSaturday.getTime() + DAY_MS * 3 - 1),
    maxParticipants: 10,
    requirements: "能语音优先，不强制段位。",
    voiceChannel: "Discord / 开黑啦均可。",
    registrations: [{ id: "r4" }],
  },
] as const;

export const demoProfiles = [
  {
    id: "demo-player-1",
    avatarUrl: "",
    displayName: "晨星",
    slogan: "先保队友，再找机会。",
    mainRole: "SUPPORT",
    mainHeroes: ["安娜", "巴蒂斯特"],
  },
  {
    id: "demo-player-2",
    avatarUrl: "",
    displayName: "回声轨道",
    slogan: "愿意补位，也愿意指挥。",
    mainRole: "FLEX",
    mainHeroes: ["D.Va", "黑影", "禅雅塔"],
  },
  {
    id: "demo-player-3",
    avatarUrl: "",
    displayName: "南极靶场",
    slogan: "今晚少白给一波。",
    mainRole: "DAMAGE",
    mainHeroes: ["士兵：76", "艾什"],
  },
] as const;

// 没有数据库时首页和文章列表也要有内容可看，否则整块是空的。
export const demoArticles = [
  {
    id: "demo-article-rules",
    title: "内战分队规则：我们怎么做平衡",
    excerpt:
      "按报名位置先补齐坦克和支援，再用最近三次内战的胜负做微调。规则公开，随时可以质疑。",
    coverUrl: "",
    pinned: true,
    publishedAt: new Date(today.getTime() - DAY_MS * 2),
    author: { profile: { displayName: "社区编辑" } },
  },
  {
    id: "demo-article-newbie",
    title: "第一次参加社区活动，需要准备什么",
    excerpt:
      "补全资料、能开语音、准时到场，这三件事就够了。段位不影响报名，我们更在意稳定出勤。",
    coverUrl: "",
    pinned: false,
    publishedAt: new Date(today.getTime() - DAY_MS * 9),
    author: { profile: { displayName: "晨星" } },
  },
  {
    id: "demo-article-recap",
    title: "上周内战回顾：三场拉锯和一个意外阵容",
    excerpt:
      "末段守点的双重装组合出人意料地成立，也暴露了我们在开团时机上的老问题。",
    coverUrl: "",
    pinned: false,
    publishedAt: new Date(today.getTime() - DAY_MS * 16),
    author: { profile: { displayName: "回声轨道" } },
  },
] as const;
