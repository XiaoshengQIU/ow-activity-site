import { Suspense } from "react";
import { EventCard } from "@/components/event-card";
import { PlayerCard } from "@/components/profile-card";
import { PlayerCarousel } from "@/components/player-carousel";
import { ArticleCard } from "@/components/article-card";
import { ButtonLink, Card, Notice } from "@/components/ui";
import { getLatestArticles } from "@/lib/articles-data";
import { isAdminSetupOpen } from "@/lib/auth";
import { getHomeData } from "@/lib/data";
import { getSiteSettings } from "@/lib/site-settings";
import { createSiteText } from "@/lib/site-config";

export const dynamic = "force-dynamic";

// 标题和入口按钮不依赖数据库，先画出来；卡片列表各自流式补上。
function CardsFallback() {
  return (
    <div className="home-card-list" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <Card key={index} className="home-empty">
          <div className="nav-shimmer h-5 w-2/3 rounded-lg" />
          <div className="nav-shimmer mt-3 h-4 w-full rounded-lg" />
        </Card>
      ))}
    </div>
  );
}

async function HomeNotices() {
  const [{ isDemo }, setupOpen] = await Promise.all([
    getHomeData(),
    isAdminSetupOpen(),
  ]);
  return (
    <>
      {isDemo ? (
        <Notice>当前为页面演示，连接数据库后展示真实活动和玩家。</Notice>
      ) : null}
      {setupOpen ? (
        <Notice>
          站点还没有管理员，请先{" "}
          <a href="/admin/setup" className="text-accent underline">
            注册首位管理员
          </a>
          ，或在同一页用以前的备份 ZIP 恢复。
        </Notice>
      ) : null}
    </>
  );
}

async function HomeEvents() {
  const { events } = await getHomeData();
  const upcoming = events.toSorted(
    (a, b) =>
      Number(b.status === "RUNNING") - Number(a.status === "RUNNING") ||
      a.startTime.getTime() - b.startTime.getTime(),
  );
  if (!upcoming.length)
    return (
      <Card className="home-empty">
        <p className="home-empty-title">还没有排上活动</p>
        <p>下一场排定后会出现在这里，也可以先去看看往期活动。</p>
      </Card>
    );
  return (
    <div className="home-card-list">
      {upcoming.slice(0, 3).map((event, index) => (
        <EventCard
          key={event.id}
          event={event}
          variant={index === 0 ? "featured" : "compact"}
        />
      ))}
    </div>
  );
}

async function HomeArticles() {
  const articles = await getLatestArticles();
  if (!articles.length)
    return (
      <Card className="home-empty">
        <p className="home-empty-title">还没有发布文章</p>
        <p>规则说明、活动回顾和新人指南都会发在这里。</p>
      </Card>
    );
  return (
    <div className="home-card-list">
      {articles.map((article, index) => (
        <ArticleCard
          key={article.id}
          article={article}
          variant={index === 0 ? "featured" : "compact"}
        />
      ))}
    </div>
  );
}

async function HomePlayers() {
  const { profiles } = await getHomeData();
  if (!profiles.length) return null;
  return (
    <section className="home-section" aria-labelledby="home-players">
      <div className="section-heading">
        <h2 id="home-players" className="section-title">
          交大玩家
        </h2>
        <ButtonLink href="/players" variant="ghost" size="sm">
          全部玩家
        </ButtonLink>
      </div>
      <PlayerCarousel>
        {profiles.map((profile) => (
          <PlayerCard key={profile.id} profile={profile} />
        ))}
      </PlayerCarousel>
    </section>
  );
}

export default async function Home() {
  // 根布局已经取过一次，React cache 让这里不再产生查询。
  const { configuration } = await getSiteSettings();
  const t = createSiteText(configuration);
  const customImage =
    configuration.images.hero &&
    !["/arena-v2.webp", "/arena-cover.png"].includes(configuration.images.hero)
      ? configuration.images.hero
      : "";
  return (
    <main className="page-shell community-home">
      <section className="home-intro" aria-labelledby="welcome-title">
        <div className="home-intro-copy">
          <p className="home-eyebrow">上海交大 · 守望先锋玩家社区</p>
          <h1 id="welcome-title">
            <span>{t("home.title1")}</span>
            <span>{t("home.title2")}</span>
          </h1>
          <p className="home-description">{t("home.description")}</p>
        </div>
        {customImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- 管理员设置的首页配图
          <img className="home-custom-image" src={customImage} alt="社区配图" />
        ) : (
          <ButtonLink href="/events" className="home-join">
            查看活动
          </ButtonLink>
        )}
      </section>
      <Suspense fallback={null}>
        <HomeNotices />
      </Suspense>
      <div className="home-content-grid">
        <section className="home-section" aria-labelledby="home-events">
          <div className="section-heading">
            <h2 id="home-events" className="section-title">
              近期活动
            </h2>
            <ButtonLink href="/events" variant="ghost" size="sm">
              全部活动
            </ButtonLink>
          </div>
          <Suspense fallback={<CardsFallback />}>
            <HomeEvents />
          </Suspense>
        </section>
        <section className="home-section" aria-labelledby="home-articles">
          <div className="section-heading">
            <h2 id="home-articles" className="section-title">
              最新文章
            </h2>
            <ButtonLink href="/articles" variant="ghost" size="sm">
              全部文章
            </ButtonLink>
          </div>
          <Suspense fallback={<CardsFallback />}>
            <HomeArticles />
          </Suspense>
        </section>
      </div>
      <Suspense fallback={null}>
        <HomePlayers />
      </Suspense>
    </main>
  );
}
