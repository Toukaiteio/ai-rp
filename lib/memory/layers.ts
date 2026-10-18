/**
 * 记忆分层。
 *
 * 五层各管一件事，生命周期和注入位置都不一样。把它们显式写出来，
 * 是为了不再出现「一条随口提到的细节被塞进长期设定」这种事——
 * 每一层都有自己的写入规则和淘汰方式。
 *
 * 这些层大部分已经存在（场景状态、剧情线、人物/地点目录、摘要），
 * 这里做的是给它们一个统一的名字和一份可查的说明书。
 */

export type MemoryLayerId =
  | "scene"
  | "character"
  | "world"
  | "plot"
  | "style";

export interface MemoryLayerInfo {
  id: MemoryLayerId;
  label: string;
  /** 这一层记什么 */
  holds: string;
  /** 存在哪儿 */
  stored: string;
  /** 拼进提示词的哪个位置 */
  injected: string;
  /** 怎么淘汰 */
  lifetime: string;
}

export const MEMORY_LAYERS: readonly MemoryLayerInfo[] = [
  {
    id: "scene",
    label: "当前场景记忆",
    holds: "此刻在哪儿、什么时候、谁在场、正在发生什么、气氛",
    stored: "会话（ChatSession.sceneState）",
    injected: "回合层「当前场景」，每个字段带可信度",
    lifetime: "每轮只保存变化项，被新值覆盖",
  },
  {
    id: "character",
    label: "角色记忆",
    holds: "人物关系、习惯、过去的事件",
    stored: "本机记忆目录 characters（IndexedDB）",
    injected: "历史之后的记忆目录，按最近轮次排",
    lifetime: "同名再写是更新；确认过的条目不会被推断覆盖",
  },
  {
    id: "world",
    label: "世界记忆",
    holds: "地点、组织、规则、背景",
    stored: "本机记忆目录 places + 角色卡的世界书",
    injected: "世界书进前缀，目录进历史之后",
    lifetime: "世界书跟着卡走；目录条目按上限淘汰",
  },
  {
    id: "plot",
    label: "剧情记忆",
    holds: "悬念、伏笔、已解决的事件",
    stored: "会话（ChatSession.storyThreads）+ 目录 events",
    injected: "回合层「还没交代完的几件事」，每轮最多三条",
    lifetime: "已解决的不再注入，也不能被重新打开",
  },
  {
    id: "style",
    label: "风格记忆",
    holds: "角色常用语、说话节奏、禁用表达",
    stored: "本机记忆目录 style",
    injected: "历史之后的记忆目录，和人物地点并列",
    lifetime: "来自角色卡或玩家明确要求，几乎不变",
  },
];

export function layerOf(id: MemoryLayerId): MemoryLayerInfo {
  const found = MEMORY_LAYERS.find((layer) => layer.id === id);
  if (!found) throw new Error(`未知的记忆层：${id}`);
  return found;
}

/** 面板和文档用的一段说明。 */
export function describeLayers(): string {
  return MEMORY_LAYERS.map(
    (layer) => `${layer.label}（${layer.id}）：记${layer.holds}；存在${layer.stored}；注入在${layer.injected}。`,
  ).join("\n");
}
