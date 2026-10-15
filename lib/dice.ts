/**
 * 跑团掷骰。点数在浏览器里用 crypto 生成，模型只能拿到结果，不能自己编。
 */

export interface NotationRoll {
  notation: string;
  total: number;
  detail: string;
}

const NOTATION = /^(\d{0,3})d(\d{1,4})([+-]\d{1,4})?$/i;

/** 0 到 span-1。span 不能整除 2^32 时丢掉尾部，避免低点数偏多。 */
function cryptoIndex(span: number): number {
  if (span <= 1) return 0;
  const limit = Math.floor(0x1_0000_0000 / span) * span;
  const buffer = new Uint32Array(1);
  let value = 0;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0] ?? 0;
  } while (value >= limit);
  return value % span;
}

/** 解析 1d20、2d6+3、d100。不合规则返回 null，不掷。 */
export function rollNotation(
  input: string,
  nextInt: (span: number) => number = cryptoIndex,
): NotationRoll | null {
  const match = NOTATION.exec(input.trim().replace(/\s+/g, ""));
  if (!match) return null;
  const count = match[1] ? Number(match[1]) : 1;
  const sides = Number(match[2]);
  const modifier = match[3] ? Number(match[3]) : 0;
  if (count < 1 || count > 20) return null;
  if (sides < 2 || sides > 100) return null;
  if (modifier < -100 || modifier > 100) return null;

  const faces: number[] = [];
  for (let i = 0; i < count; i += 1) faces.push(nextInt(sides) + 1);
  const sum = faces.reduce((total, face) => total + face, 0);
  const modText = modifier === 0 ? "" : modifier > 0 ? `+${modifier}` : `${modifier}`;
  const notation = `${count}d${sides}${modText}`;
  const shown = faces.join("+");
  const detail =
    modifier === 0
      ? `${notation} = ${sum}（${shown}）`
      : `${notation} = ${sum + modifier}（${shown}${modText}）`;
  return { notation, total: sum + modifier, detail };
}

export function describeRoll(rawArguments: string): string {
  let notation = "";
  try {
    const parsed: unknown = JSON.parse(rawArguments);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const args = parsed as Record<string, unknown>;
      if (typeof args.notation === "string") notation = args.notation;
      else if (args.sides !== undefined) {
        const count = typeof args.count === "number" ? args.count : 1;
        const modifier = typeof args.modifier === "number" ? args.modifier : 0;
        const mod = modifier === 0 ? "" : modifier > 0 ? `+${modifier}` : `${modifier}`;
        notation = `${count}d${args.sides}${mod}`;
      }
    }
  } catch {
    notation = "";
  }
  if (!notation.trim()) return "缺少 notation。写成 1d20、2d6+3 或 d100。";
  const rolled = rollNotation(notation);
  if (!rolled) {
    return `「${notation.trim().slice(0, 40)}」不能掷。用 1d20、2d6+3、d100 这种，骰子最多 20 个，面数 2 到 100。`;
  }
  return rolled.detail;
}

/** 发给 Chat Completions 的掷骰工具。执行在浏览器，不在服务端。 */
export const DICE_TOOL = {
  type: "function" as const,
  function: {
    name: "roll_dice",
    description:
      "掷骰。攻击、检定、伤害和任何需要随机点数的场面，先调用这个工具，再用返回的点数往下写。不要自己编点数。notation 如 1d20、2d6+3、d100。一次只掷一种。",
    parameters: {
      type: "object",
      properties: {
        notation: { type: "string", description: "如 1d20、2d6+3、d100" },
      },
      required: ["notation"],
    },
  },
};
