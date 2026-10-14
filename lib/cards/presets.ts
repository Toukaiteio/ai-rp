import rawAeria from "@/data/cards/aeria.json";
import rawLiangXiaoman from "@/data/cards/liang-xiaoman.json";
import rawLinWanqing from "@/data/cards/lin-wanqing.json";
import rawShenGuhong from "@/data/cards/shen-guhong.json";
import rawZhouWanzhou from "@/data/cards/zhou-wanzhou.json";
import type { CardEntry } from "./types";
import { parseCharacterCard } from "./validate";

/**
 * 预设角色卡。
 *
 * 这里用静态 import 而不是运行时读目录：Vercel 的 serverless 函数只会打包
 * 能被静态分析到的文件，fs.readdir 出来的文件不保证进部署产物。
 * 代价是加一张卡要多写一行 import，换来的是部署后一定读得到。
 */
const SOURCES: Array<{ id: string; raw: unknown }> = [
  { id: "lin-wanqing", raw: rawLinWanqing },
  { id: "zhou-wanzhou", raw: rawZhouWanzhou },
  { id: "liang-xiaoman", raw: rawLiangXiaoman },
  { id: "aeria", raw: rawAeria },
  { id: "shen-guhong", raw: rawShenGuhong },
];

function build(): CardEntry[] {
  const entries: CardEntry[] = [];
  for (const { id, raw } of SOURCES) {
    const parsed = parseCharacterCard(raw);
    if (!parsed.ok) {
      // 预设卡写坏了要立刻看见，不能静默消失
      console.warn(`[cards] 预设卡 ${id} 解析失败：${parsed.error}`);
      continue;
    }
    entries.push({ id, card: parsed.card, source: "preset" });
  }
  return entries;
}

export const PRESET_CARDS: CardEntry[] = build();

export const DEFAULT_CARD_ID = "lin-wanqing";

export function findPresetCard(id: string): CardEntry | undefined {
  return PRESET_CARDS.find((entry) => entry.id === id);
}
