import { z } from "zod";
import { copyFields } from "@/lib/site-copy";

export const imageFields = [
  {
    key: "logo",
    label: "站点 Logo",
    description: "显示在站名旁，留空只显示站名。",
    defaultValue: "",
  },
  {
    key: "favicon",
    label: "浏览器标签页图标",
    description: "用于浏览器标签页，建议上传正方形 PNG。",
    defaultValue: "/favicon.ico",
  },
  {
    key: "hero",
    label: "首页配图",
    description: "可选，显示在首页简介旁。建议横向图片，留空不显示。",
    defaultValue: "",
  },
  {
    key: "event",
    label: "活动默认封面",
    description: "活动未单独设置封面时使用，显示在活动卡片和详情页。",
    defaultValue: "",
  },
] as const;
export type ImageKey = (typeof imageFields)[number]["key"];
export type SiteConfiguration = {
  texts: Record<string, string>;
  images: Record<ImageKey, string>;
  // Retained for stored configuration compatibility; HeroUI owns theme colors.
  accent: string;
};
export const defaultSiteConfiguration: SiteConfiguration = {
  texts: {},
  images: Object.fromEntries(
    imageFields.map((field) => [field.key, field.defaultValue]),
  ) as SiteConfiguration["images"],
  accent: "#bb273b",
};
const fieldMap = new Map(copyFields.map((field) => [field.key, field]));
/**
 * 首页主标题按空行分段：段与段之间换行显示，段内保持一行。
 * 旧配置把标题拆成 home.title1 / home.title2 两个字段，这里合并回来，
 * 管理员改过的文案不会因为字段调整而丢失。
 */
export function homeTitleLines(configuration: SiteConfiguration): string[] {
  const t = createSiteText(configuration);
  const merged = configuration.texts["home.title"];
  const source =
    merged !== undefined
      ? merged
      : [
          configuration.texts["home.title1"],
          configuration.texts["home.title2"],
        ].some((value) => value !== undefined)
        ? [
            configuration.texts["home.title1"] ?? "",
            configuration.texts["home.title2"] ?? "",
          ]
            .filter(Boolean)
            .join("\n\n")
        : t("home.title");
  const split = (value: string) =>
    value
      .split(/\n\s*\n/)
      .map((line) => line.replace(/\s*\n\s*/g, " ").trim())
      .filter(Boolean);
  const lines = split(source);
  // 必填校验挡得住空标题，真出现空值时回落到默认文案而不是渲染一行空白。
  return lines.length ? lines : split(fieldMap.get("home.title")!.defaultValue);
}

export function createSiteText(configuration: SiteConfiguration) {
  return (key: string): string =>
    configuration.texts[key] ?? fieldMap.get(key)?.defaultValue ?? key;
}
export function isSafeImageSource(value: string) {
  if (
    value === "" ||
    value === "/favicon.ico" ||
    value === "/arena-cover.png" ||
    value === "/arena-v2.webp"
  )
    return true;
  if (/^\/api\/site-assets\/[a-z0-9]{20,40}$/.test(value)) return true;
  try {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
const inputSchema = z
  .object({
    texts: z.record(z.string(), z.string().max(1000)).default({}),
    images: z.record(z.string(), z.string().max(2048)).default({}),
    accent: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#bb273b"),
  })
  .strict();
export function validateSiteConfiguration(input: unknown): SiteConfiguration {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    throw new Error("设置格式有误。请检查文字长度，或刷新页面后重试。");
  const { texts: inputTexts, images, accent } = parsed.data;
  const texts: Record<string, string> = {};
  for (const [key, value] of Object.entries(inputTexts)) {
    const field = fieldMap.get(key);
    if (!field) throw new Error("包含无效的设置项，请刷新页面后重试。");
    if (field.required && !value.trim())
      throw new Error("「" + field.label + "」不能为空。");
    if (key === "brand.name" && value.length > 40)
      throw new Error("站点名称最多 40 字。");
    if (value !== field.defaultValue) texts[key] = value;
  }
  for (const [key, value] of Object.entries(images)) {
    if (
      !imageFields.some((field) => field.key === key) ||
      !isSafeImageSource(value)
    )
      throw new Error("图片地址只支持 HTTP、HTTPS 或本站上传的图片。");
  }
  return {
    texts,
    images: {
      ...defaultSiteConfiguration.images,
      ...Object.fromEntries(
        Object.entries(images).map(([key, value]) => [
          key,
          value === "/arena-cover.png" ? "/arena-v2.webp" : value,
        ]),
      ),
    },
    accent,
  };
}
