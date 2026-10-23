import { BROWSER_PROVIDER_ID, probeBrowserModel, streamBrowserChat } from "@/lib/browser-model";
import { authHeaders, cleanApiKey } from "@/lib/providers/apikey";
import { isConfigured, usesBrowserModel, withImage, type ProviderConfig } from "@/lib/providers/settings";
import { resolveBaseURL } from "@/lib/providers/validate";
import { readSseText } from "@/lib/wire";
import type { CharacterCard } from "./types";

export type CardPolishField =
  | "description"
  | "personality"
  | "scenario"
  | "first_mes"
  | "mes_example"
  | "alternate_greetings"
  | "system_prompt"
  | "post_history_instructions"
  | "author_note"
  | "voice"
  | "map_title"
  | "codex_title"
  | "codex_entry_title"
  | "codex_entry_content"
  | "codex_entry_tags"
  | "script_title";

const FIELD_GUIDANCE: Record<CardPolishField, string> = {
  description: "角色简介、外貌、背景和关系",
  personality: "性格、矛盾点和触发点",
  scenario: "时间、地点、氛围和当前情境",
  first_mes: "角色开场白",
  mes_example: "对话示例中的措辞和节奏",
  alternate_greetings: "备用开场白",
  system_prompt: "角色专属系统提示",
  post_history_instructions: "历史后的角色约束",
  author_note: "默认作者注中的写作要求",
  voice: "角色声音档案中的词汇、习惯或示例台词",
  map_title: "地图附件标题",
  codex_title: "Codex 附件标题",
  codex_entry_title: "Codex 条目标题",
  codex_entry_content: "Codex 条目内容",
  codex_entry_tags: "Codex 条目标签",
  script_title: "脚本附件标题",
};

function polishMessages(card: CharacterCard, field: CardPolishField, value: string) {
  return [
    {
      role: "system" as const,
      content: [
        "你是角色卡编辑助手。只润色用户提供的字段，不要解释过程，不要输出标题或 Markdown 代码围栏。",
        `字段用途：${FIELD_GUIDANCE[field]}。`,
        "保留原文事实、专有名词、{{宏}}、XML 消息块标签及 who 属性；不要擅自新增人物、地点、事件或能力。",
        "如果原文已经清楚，做轻量调整即可。只返回润色后的纯文本。",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: `角色名：${card.data.name}\n字段：${field}\n原文：\n${value}`,
    },
  ];
}

export async function polishCardField(
  card: CharacterCard,
  field: CardPolishField,
  value: string,
  options?: { signal?: AbortSignal; config?: ProviderConfig },
): Promise<string> {
  const source = value.trim();
  if (!source) throw new Error("polish_empty");
  const config = withImage(options?.config ?? undefined);
  const signal = options?.signal;
  signal?.throwIfAborted();
  const browserReady = await probeBrowserModel();
  signal?.throwIfAborted();
  const local = usesBrowserModel(config, browserReady);
  const resolved = local ? null : resolveBaseURL(config.providerId, config.baseURL);
  if (!local && (config.providerId === BROWSER_PROVIDER_ID || !isConfigured(config) || !resolved || "error" in resolved)) {
    throw new Error("polish_not_configured");
  }

  const messages = polishMessages(card, field, source);
  let result = "";
  if (local) {
    await streamBrowserChat({
      messages,
      temperature: Math.min(0.7, Math.max(0.1, config.temperature)),
      signal,
      onDelta: (delta) => { result += delta; },
    });
  } else {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(cleanApiKey(config.apiKey).value) },
      signal,
      body: JSON.stringify({
        mode: "complete",
        providerId: config.providerId,
        interfaceType: config.interfaceType,
        model: config.model.trim(),
        baseURL: resolved && "baseURL" in resolved ? resolved.baseURL : undefined,
        messages,
        temperature: Math.min(0.7, Math.max(0.1, config.temperature)),
        reasoningEffort: "low",
        maxTokens: 900,
      }),
    });
    if (!response.ok) throw new Error("polish_request_failed");
    if (!response.body) throw new Error("polish_empty_response");
    result = await readSseText(response.body);
  }

  const polished = result.trim().replace(/^```(?:text|markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!polished) throw new Error("polish_empty_response");
  return polished;
}
