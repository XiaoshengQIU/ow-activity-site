import type { Metadata } from "next";
import { AriaRouterProvider } from "@/components/aria-router";
import { Header } from "@/components/header";
import { SiteContentProvider } from "@/components/site-content";
import { createSiteText } from "@/lib/site-config";
import { getSiteSettings } from "@/lib/site-settings";
import "./globals.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const vercelHostname =
  process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
export async function generateMetadata(): Promise<Metadata> {
  const { configuration } = await getSiteSettings();
  const t = createSiteText(configuration);
  return {
    metadataBase: new URL(
      process.env.SITE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
        (vercelHostname
          ? "https://" + vercelHostname
          : "http://localhost:3000"),
    ),
    title: { default: t("brand.name"), template: "%s | " + t("brand.name") },
    description: t("brand.metaDescription"),
    icons: { icon: configuration.images.favicon || "/favicon.ico" },
  };
}
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { configuration } = await getSiteSettings();
  return (
    <html lang="zh-CN" className="light">
      <body>
        <AriaRouterProvider>
          <SiteContentProvider configuration={configuration}>
            <Header>{children}</Header>
          </SiteContentProvider>
        </AriaRouterProvider>
      </body>
    </html>
  );
}
