import { PRESET_CARDS } from "@/lib/cards/presets";
import { parseCharacterCard, serializeCard } from "@/lib/cards/validate";
import { blocksToPlainText, blocksToRaw, parseBlocks } from "@/lib/blocks";
import { assemble, emptySummary, type AssembleInput } from "@/lib/prompt";
import type { CharacterCardData } from "@/lib/cards/types";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}  ${detail}`);
  }
}

const BIG_BUDGET = 100_000;

function assembleCard(card: CharacterCardData, extra: Partial<AssembleInput> = {}) {
  return assemble({
    card,
    lorebook: card.character_book ? { entries: card.character_book.entries } : undefined,
    history: [{ role: "assistant", content: card.first_mes }],
    seed: 42,
    budget: BIG_BUDGET,
    ...extra,
  });
}

console.log("\n[1] 预设卡解析");
check("预设卡都解析成功", PRESET_CARDS.length === 5, `got ${PRESET_CARDS.length}`);

const lin = PRESET_CARDS.find((c) => c.id === "lin-wanqing")?.card;
check("林晚晴存在", !!lin);
if (!lin) process.exit(1);
const d = lin.data;

console.log("\n[2] 林晚晴字段完整度");
check("name", d.name === "林晚晴", d.name);
check("description 写满（>300 字）", d.description.length > 300, `${d.description.length}`);
check("description 含外貌", d.description.includes("外貌"));
check("description 含来历", d.description.includes("来历"));
check("description 含习惯", d.description.includes("习惯"));
check("description 含和玩家的关系", d.description.includes("和玩家的关系"));
check("personality 含矛盾点", d.personality.includes("矛盾点"));
check("personality 含触发点", d.personality.includes("触发点"));
check("scenario 含时间", d.scenario.includes("亥时"));
check("scenario 含地点", d.scenario.includes("一楼"));
check("scenario 含氛围", d.scenario.includes("雨声"));
check("first_mes 非空", d.first_mes.trim().length > 0);
check("post_history_instructions 非空", (d.post_history_instructions ?? "").length > 100);

const starts = (d.mes_example ?? "").split("<START>").length - 1;
check("mes_example 至少 3 个 <START>", starts >= 3, `got ${starts}`);
check("mes_example 含 {{user}} 宏", (d.mes_example ?? "").includes("{{user}}"));
check("mes_example 含 {{char}} 宏", (d.mes_example ?? "").includes("{{char}}"));
check("alternate_greetings 至少 2 条", (d.alternate_greetings ?? []).length >= 2);

console.log("\n[3] 简化版世界书结构");
const entries = d.character_book?.entries ?? [];
check("有世界书条目", entries.length > 0, `${entries.length}`);
const allowed = new Set(["keys", "content", "constant"]);
let extraField = "";
for (const entry of entries) {
  for (const key of Object.keys(entry)) {
    if (!allowed.has(key)) extraField = key;
  }
}
check("条目只有 keys / content / constant", extraField === "", `多了字段 ${extraField}`);
check("有常驻条目", entries.some((e) => e.constant === true));

console.log("\n[4] 世界书：只有 content 进提示词，keys 不进");
{
  const target = entries.find((e) => e.keys.includes("北方"));
  check("找得到 keys 含「北方」的条目", !!target);
  if (target) {
    check("该条目 content 本身不含「北方」", !target.content.includes("北方"));

    const { messages, budget } = assembleCard(d, {
      history: [
        { role: "assistant", content: d.first_mes },
        { role: "user", content: "你到底是从北方哪里来的？" },
      ],
    });
    const book = messages.find((m) => m.content.includes(target.content.slice(0, 20)));
    check("content 进了提示词", !!book);
    if (book) {
      check("keys 本身没进提示词", !book.content.includes("北方"), book.content.slice(0, 80));
      check("没有【keys】这种索引残留", !book.content.includes("【"));
    }
    check("预算统计有世界书条数", budget.lorebookEntries > 0, `${budget.lorebookEntries}`);
  }
}

console.log("\n[5] 消息块协议");
{
  const raw =
    "<narr>雨声压在屋檐上。</narr>\n" +
    '<dlg who="林晚晴">热酒没有。</dlg>\n' +
    "<scene>场景切换 · 二楼</scene>\n" +
    "<player>我今晚能留宿吗？</player>";
  const blocks = parseBlocks(raw);
  check("解析出 4 块", blocks.length === 4, `got ${blocks.length}`);
  check("narr 块", blocks[0]?.kind === "narr" && blocks[0].text === "雨声压在屋檐上。");
  check("dlg 块带 who", blocks[1]?.kind === "dlg" && blocks[1].who === "林晚晴");
  check("scene 块", blocks[2]?.kind === "scene");
  check("player 块", blocks[3]?.kind === "player");
  check("blocksToRaw 能还原", blocksToRaw(blocks) === raw, blocksToRaw(blocks));

  const plain = blocksToPlainText(blocks);
  check("纯文本抹掉了标记", !plain.includes("<narr>") && !plain.includes("<dlg"));
  check("纯文本保留了对白内容", plain.includes("热酒没有。"));
  check("纯文本保留了旁白内容", plain.includes("雨声压在屋檐上。"));
  check("旁白语义标记可保留", blocksToPlainText(blocks, { narratorMarker: "〔旁白〕" }).includes("〔旁白〕雨声压在屋檐上。"));
  check("未闭合的旁白按旁白渲染", parseBlocks("<narr>雨还在下，她")[0]?.kind === "narr");
  check("无标记文本按对白兜底", parseBlocks("就是一段没有标记的文本")[0]?.kind === "dlg");
}

console.log("\n[6] 玩家输入还原为纯文本");
{
  const { messages } = assembleCard(d, {
    history: [
      { role: "assistant", content: d.first_mes },
      { role: "user", content: "<player>来杯热姜茶</player>" },
    ],
  });
  const userMessages = messages.filter((m) => m.role === "user");
  check(
    "user 消息里没有 <player> 标记",
    userMessages.every((m) => !m.content.includes("<player>")),
    JSON.stringify(userMessages),
  );
  check("user 消息保留了原话", userMessages.some((m) => m.content === "来杯热姜茶"));
  const assistant = messages.find((m) => m.role === "assistant");
  check("assistant 历史保留块标记", !!assistant?.content.includes("<narr>"), assistant?.content.slice(0, 40));
}

console.log("\n[7] 导入解析的宽容度");
{
  const bare = parseCharacterCard({
    name: "测试角色",
    description: "描述",
    personality: "性格",
    scenario: "场景",
    first_mes: "开场",
    unknown_field: "保留我",
  });
  check("裸对象（无 data 外壳）可解析", bare.ok);
  if (bare.ok) {
    check("未知字段进了 extensions._unmapped", JSON.stringify(bare.card.data.extensions?._unmapped ?? {}).includes("保留我"));
    check("导出可序列化", serializeCard(bare.card).includes("测试角色"));
  }

  check("缺 name 被拒", !parseCharacterCard({ description: "x" }).ok);
  check("非对象被拒", !parseCharacterCard("nope").ok);
  check("数组被拒", !parseCharacterCard([]).ok);

  const legacy = parseCharacterCard({
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: "旧卡",
      description: "",
      personality: "",
      scenario: "",
      first_mes: "hi",
      character_book: {
        entries: [
          { keys: ["a"], content: "内容", constant: true, enabled: true, insertion_order: 5 },
          { keys: [], content: "" },
        ],
      },
    },
  });
  check("旧卡（含多余世界书字段）可解析", legacy.ok);
  if (legacy.ok) {
    check("多余字段被丢掉", legacy.card.data.character_book?.entries.length === 1);
  }
}

console.log("\n[8] 导出字段完整性与往返一致性");
{
  const DECLARED = [
    "name", "description", "personality", "scenario", "first_mes", "mes_example",
    "system_prompt", "post_history_instructions", "alternate_greetings",
    "character_book", "tags", "creator", "character_version", "extensions",
  ];
  const missing = DECLARED.filter((field) => !(field in d));
  check("导出的卡含全部声明字段", missing.length === 0, `缺 ${missing.join(", ")}`);

  const reparsed = parseCharacterCard(JSON.parse(serializeCard(lin)));
  check("导出再导入可解析", reparsed.ok);
  if (reparsed.ok) {
    check("往返后字段完全一致", JSON.stringify(reparsed.card.data) === JSON.stringify(lin.data));
    check("往返后块标记未丢失", reparsed.card.data.first_mes === lin.data.first_mes);
  }

  const bare = parseCharacterCard({ name: "最小卡", first_mes: "hi" });
  if (bare.ok) {
    const withoutBook = DECLARED.filter((f) => f !== "character_book");
    check("最小卡也补齐了其余声明字段", withoutBook.every((f) => f in bare.card.data));
    check("最小卡不含空世界书", !("character_book" in bare.card.data));
  }
}

console.log("\n[9] 组装器契约");
{
  const first = assembleCard(d);
  const second = assembleCard(d);
  check("同样输入输出字节级一致", JSON.stringify(first.messages) === JSON.stringify(second.messages));
  check("同样输入 cacheKey 一致", first.cacheKey === second.cacheKey);

  // 前缀里不能有变量内容：时间戳、随机数、请求 ID
  const prefixText = first.messages.map((m) => m.content).join("\n");
  check("前缀不含时间戳", !/\d{4}-\d{2}-\d{2}|\d{13,}|Date.now/.test(prefixText), prefixText.slice(0, 120));
  check("前缀不含随机数", !/Math.random/.test(prefixText));

  const changed = assembleCard({ ...d, description: d.description + "改了一点。" });
  check("改卡后 cacheKey 变化", changed.cacheKey !== first.cacheKey);

  const differentSeed = assembleCard(d, { seed: 999 });
  check("seed 不改变 cacheKey（前缀只由内容决定）", differentSeed.cacheKey === first.cacheKey);
}

console.log("\n[10] 摘要与关键事实");
{
  const empty = emptySummary();
  check("空摘要可构造", empty.text === "" && empty.coveredIndex === 0);

  const withFacts = assembleCard(d, {
    summary: { text: "玩家问起了北方的旧事。", coveredIndex: 1, compressedCount: 1 },
    facts: {
      characters: { 林晚晴: "在店里添柴" },
      places: { 晚星旅店: "一楼酒堂" },
      flags: { 已欠账: true },
    },
  });
  const flat = withFacts.messages.map((m) => m.content).join("\n");
  check("摘要进了提示词", flat.includes("玩家问起了北方的旧事。"));
  check("关键事实进了提示词", flat.includes("林晚晴（在店里添柴）"));
  check("地点事实进了提示词", flat.includes("晚星旅店（一楼酒堂）"));
  check("旗标事实进了提示词", flat.includes("已欠账"));
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
