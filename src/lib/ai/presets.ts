// 一个 OpenAI 兼容的 base URL 加一把 key，模型名由该网关暴露什么就填什么，
// 与 one-api / New API / LiteLLM 的用法一致。
// 下面的地址均来自各厂商自己的公开文档；带版本号的路径原样保留，
// openaiCompatibleRoot 只在结尾没有 /vN 时才补 /v1。
export const AI_PRESETS = [
  // 国内常用
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
  },
  {
    id: "siliconflow",
    label: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
  },
  {
    id: "dashscope",
    label: "通义千问（兼容模式）",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
  {
    id: "moonshot",
    label: "Kimi / Moonshot",
    baseUrl: "https://api.moonshot.cn/v1",
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  },
  {
    id: "doubao",
    label: "豆包（火山方舟）",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  },
  {
    id: "hunyuan",
    label: "腾讯混元",
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
  },
  {
    id: "qianfan",
    label: "百度千帆",
    baseUrl: "https://qianfan.baidubce.com/v2",
  },
  {
    id: "minimax",
    label: "MiniMax",
    baseUrl: "https://api.minimaxi.com/v1",
  },
  {
    id: "stepfun",
    label: "阶跃星辰",
    baseUrl: "https://api.stepfun.com/v1",
  },
  {
    id: "modelscope",
    label: "魔搭 ModelScope",
    baseUrl: "https://api-inference.modelscope.cn/v1",
  },
  // 国际
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
  },
  {
    id: "xai",
    label: "xAI Grok",
    baseUrl: "https://api.x.ai/v1",
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
  },
  {
    id: "mistral",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
  },
  {
    id: "together",
    label: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
  },
  // 自建：地址由管理员填写
  {
    id: "ollama",
    label: "Ollama（本机）",
    baseUrl: "http://localhost:11434/v1",
  },
  {
    id: "lmstudio",
    label: "LM Studio（本机）",
    baseUrl: "http://localhost:1234/v1",
  },
  {
    id: "oneapi",
    label: "One API / New API / LiteLLM",
    baseUrl: "",
  },
  {
    id: "custom",
    label: "自定义 OpenAI 兼容接口",
    baseUrl: "",
  },
] as const;

export type AiPresetId = (typeof AI_PRESETS)[number]["id"];

export const aiPresetLabels = Object.fromEntries(
  AI_PRESETS.map((preset) => [preset.id, preset.label]),
) as Record<AiPresetId, string>;

export function isAiPresetId(value: string): value is AiPresetId {
  return AI_PRESETS.some((preset) => preset.id === value);
}

export function presetBaseUrl(id: string) {
  return AI_PRESETS.find((preset) => preset.id === id)?.baseUrl ?? "";
}

export function parseAiBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("接口地址不正确。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("接口地址只支持 HTTP 或 HTTPS。");
  if (url.username || url.password)
    throw new Error("接口地址不能包含用户名或密码。");
  if (url.hash) throw new Error("接口地址不能包含片段。");
  return url.href.replace(/\/+$/, "");
}

export function openaiCompatibleRoot(baseUrl: string) {
  const trimmed = parseAiBaseUrl(baseUrl);
  return /\/v\d+$/i.test(trimmed) ? trimmed : trimmed + "/v1";
}
