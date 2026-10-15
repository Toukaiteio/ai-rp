/**
 * 卡链路自检。
 *
 * 代码里不再预制角色卡，所以这里用一张写在脚本里的样卡把同一条链路跑一遍：
 * 解析 → 往返 → 世界书进提示词 → 组装确定性 → PNG 拆卡 → 在线卡源归一化。
 * 改卡格式、改组装器、改 PNG 拆分，先跑这个。
 */
import { parseCharacterCard, serializeCard } from "@/lib/cards/validate";
import { extractCardJson } from "@/lib/cards/png";
import {
  ONLINE_SOURCE,
  normalizeOnlineCard,
  onlineCardPageUrl,
  onlineCardPngUrl,
} from "@/lib/cards/online";
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

/** 样卡：字段写全，世界书一条常驻一条关键词，覆盖真实卡的所有分支。 */
const SAMPLE_JSON = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "林晚晴",
    description:
      "晚星旅店老板娘，二十八岁。\n\n【外貌】个子不高，头发用一支木簪绾着，围裙口袋里常年装着账本和炭笔。手上有一层薄茧，是劈柴劈出来的。走路没声音，端热东西的时候拇指会翘起来，怕烫。\n\n【来历】北方渔村出身，十五岁那年村里出事，她一个人南下，盘下这间快要塌的旅店。三年了，没跟任何人提过老家，只说过一句「那边冬天比这儿长」。\n\n【习惯】每天亥时查一遍炉火，谁房间的灯亮着就多添一块炭。账记在墙上，客人赖账她不追，只在墙上那一行多看两眼。下雨天会把门廊的灯留着，说省不了几文油。\n\n【和玩家的关系】三年前玩家在这住过一宿，没给钱，留了一支木簪。今晚他又来，还是那身湿透的衣裳。她认得人，嘴上不认，动作却比上次快。",
    personality:
      "嘴上赶人，手上添茶。\n\n【矛盾点】想留人，又怕再被丢下；先摆出冷脸，动作却比话快。\n\n触发点：被人记着她的旧事（尤其是那支簪子）会先沉默，再换个话题；被谎话敷衍会直接把东西放下，转身去干活，不再搭话。",
    scenario: "亥时。晚星旅店一楼酒堂，壁炉里的火快灭了，窗外雨声不断，门缝里灌进冷风。",
    first_mes:
      "<narr>风铃响过，门被带上。晚星旅店一楼酒堂只剩壁炉里那点将灭的火，她把账本往桌上合，抬头看了你一眼，又低下去。</narr>\n<dlg who=\"林晚晴\">住店？</dlg>\n<narr>她没等你回答，已经把一盏灯往你那边推了半尺。</narr>",
    mes_example:
      "<START>\n{{user}}: 还有房间吗？\n{{char}}: <narr>她翻开账本，指尖停在空白的一页上。</narr>\n<dlg who=\"林晚晴\">有。先付钱。</dlg>\n\n<START>\n{{user}}: 你不记得我了？\n{{char}}: <narr>炭笔在指间转了一圈，没落笔。</narr>\n<dlg who=\"林晚晴\">记得。欠账的人我都记得。</dlg>\n\n<START>\n{{user}}: 外面雨太大了。\n{{char}}: <narr>她起身把门闩扣上，回身时手里多了一盏灯。</narr>\n<dlg who=\"林晚晴\">炉子我看着。你坐那边，风口。</dlg>",
    system_prompt: "",
    post_history_instructions:
      "守住人设：先回玩家刚才那句，不许替玩家决定去留；每轮先一两句看得见的动作，再开口；话短，别讲道理；不要发明她的家人、村子里的细节和旅店以外的地图；不要突然热情，也不要解释自己的过去；玩家不问就不说簪子的来历。",
    alternate_greetings: [
      "<narr>第二天一早，雨停了。她蹲在门口劈昨天没劈完的柴，看你下来，把斧头往墙根一靠。</narr>\n<dlg who=\"林晚晴\">醒了？锅里有粥。</dlg>",
      "<narr>打烊前最后一位客人走后，她开始擦桌子。你坐在角落没动，她也没赶。</narr>\n<dlg who=\"林晚晴\">灯要添油了，你去还是我去？</dlg>",
    ],
    character_book: {
      name: "晚星旅店",
      entries: [
        { keys: [], content: "晚星旅店一楼酒堂，壁炉、账本、墙上的账。", constant: true },
        { keys: ["北方", "渔村"], content: "她十五岁那年渔村出事，只身南下，从不细说。" },
      ],
    },
    tags: ["日常", "慢热", "旅店"],
    creator: "ai-rp",
    character_version: "1.0",
    extensions: {},
  },
};

const parsed = parseCharacterCard(SAMPLE_JSON);
if (!parsed.ok) {
  console.error(`样卡解析失败：${parsed.error}`);
  process.exit(1);
}
const card = parsed.card;
const d = card.data;

function assembleCard(data: CharacterCardData, extra: Partial<AssembleInput> = {}) {
  return assemble({
    card: data,
    lorebook: data.character_book ? { entries: data.character_book.entries } : undefined,
    history: [{ role: "assistant", content: data.first_mes }],
    seed: 42,
    budget: BIG_BUDGET,
    ...extra,
  });
}

console.log("\n[1] 卡解析与字段完整度");
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

console.log("\n[2] 简化版世界书结构");
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

console.log("\n[3] 世界书：只有 content 进提示词，keys 不进");
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

console.log("\n[4] 消息块协议");
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
  check(
    "旁白语义标记可保留",
    blocksToPlainText(blocks, { narratorMarker: "〔旁白〕" }).includes("〔旁白〕雨声压在屋檐上。"),
  );
  check("未闭合的旁白按旁白渲染", parseBlocks("<narr>雨还在下，她")[0]?.kind === "narr");
  check("无标记文本按对白兜底", parseBlocks("就是一段没有标记的文本")[0]?.kind === "dlg");
}

console.log("\n[5] 玩家输入还原为纯文本");
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

console.log("\n[6] 导入解析的宽容度");
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

console.log("\n[7] 导出字段完整性与往返一致性");
{
  const DECLARED = [
    "name", "description", "personality", "scenario", "first_mes", "mes_example",
    "system_prompt", "post_history_instructions", "alternate_greetings",
    "character_book", "tags", "creator", "character_version", "extensions",
  ];
  const missing = DECLARED.filter((field) => !(field in d));
  check("导出的卡含全部声明字段", missing.length === 0, `缺 ${missing.join(", ")}`);

  const reparsed = parseCharacterCard(JSON.parse(serializeCard(card)));
  check("导出再导入可解析", reparsed.ok);
  if (reparsed.ok) {
    check("往返后字段完全一致", JSON.stringify(reparsed.card.data) === JSON.stringify(card.data));
    check("往返后块标记未丢失", reparsed.card.data.first_mes === card.data.first_mes);
  }

  const bare = parseCharacterCard({ name: "最小卡", first_mes: "hi" });
  if (bare.ok) {
    const withoutBook = DECLARED.filter((f) => f !== "character_book");
    check("最小卡也补齐了其余声明字段", withoutBook.every((f) => f in bare.card.data));
    check("最小卡不含空世界书", !("character_book" in bare.card.data));
  }
}

console.log("\n[8] 组装器契约");
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

console.log("\n[9] 摘要与关键事实");
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

console.log("\n[10] PNG 内嵌卡拆解");
{
  /** 现搭一个最小 PNG：签名 + IHDR + tEXt(chara) + IEND。CRC 读取方不校验。 */
  function buildPng(payload: string): Uint8Array {
    const text = new TextEncoder().encode(payload);
    const data = new Uint8Array("chara\0".length + text.length);
    data.set(new TextEncoder().encode("chara\0"), 0);
    data.set(text, "chara\0".length);
    const out: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const push = (type: string, chunk: Uint8Array) => {
      out.push((chunk.length >>> 24) & 255, (chunk.length >>> 16) & 255, (chunk.length >>> 8) & 255, chunk.length & 255);
      for (const char of type) out.push(char.charCodeAt(0));
      for (const byte of chunk) out.push(byte);
      out.push(0, 0, 0, 0);
    };
    push("IHDR", new Uint8Array(13));
    push("tEXt", data);
    push("IEND", new Uint8Array(0));
    return new Uint8Array(out);
  }

  const b64 = Buffer.from(JSON.stringify(SAMPLE_JSON), "utf-8").toString("base64");
  const extracted = extractCardJson(buildPng(b64));
  check("tEXt 里的 base64 卡能拆出来", extracted !== null);
  const roundTrip = parseCharacterCard(extracted);
  check("拆出来的卡能解析", roundTrip.ok);
  if (roundTrip.ok) {
    check("拆出来的就是同一张卡", roundTrip.card.data.name === d.name);
  }

  check("非 PNG 返回 null", extractCardJson(new Uint8Array([1, 2, 3])) === null);
  check("没有 chara 块的 PNG 返回 null", extractCardJson(buildPng("")) === null);
}

console.log("\n[11] 在线卡源归一化");
{
  const node = {
    id: 109444,
    name: "Adventure Awaits",
    fullPath: "ratlover/adventure-awaits",
    tagline: "Play out an exciting adventure.",
    topics: ["Fantasy", "NSFW", "RPG"],
    starCount: 2836,
    avatar_url: "https://avatars.charhub.io/avatars/ratlover/adventure-awaits/avatar.webp",
    is_public: true,
  };
  const item = normalizeOnlineCard(node);
  check("节点能归一化", item !== null);
  if (item) {
    check("name 对上", item.name === "Adventure Awaits");
    check("path 取 fullPath", item.path === "ratlover/adventure-awaits");
    check("收藏数取整", item.stars === 2836);
    check("内容分级标记不回显", !item.topics.some((t) => /nsfw|sfw|r18/i.test(t)), item.topics.join(","));
    check("其余标签照常", item.topics.includes("Fantasy") && item.topics.includes("RPG"));
    check("原文地址", item.pageUrl === `${ONLINE_SOURCE.siteUrl}characters/${node.fullPath}`);
  }

  check("缺 name 被跳过", normalizeOnlineCard({ fullPath: "a/b" }) === null);
  check("私有条目被跳过", normalizeOnlineCard({ ...node, is_public: false }) === null);
  check("带 ../ 的 path 被跳过", normalizeOnlineCard({ ...node, fullPath: "../../etc/passwd" }) === null);
  check("绝对路径形状被跳过", normalizeOnlineCard({ ...node, fullPath: "/etc/passwd" }) === null);
  check("外来头像地址被换成固定地址", normalizeOnlineCard({ ...node, avatar_url: "https://evil.example/x.png" })?.avatarUrl === "https://avatars.charhub.io/avatars/ratlover/adventure-awaits/chara_card_v2.png");

  check("合法 path 能拼下载地址", onlineCardPngUrl("ratlover/adventure-awaits") === "https://avatars.charhub.io/avatars/ratlover/adventure-awaits/chara_card_v2.png");
  check("合法 path 能拼原文地址", onlineCardPageUrl("ratlover/adventure-awaits") === `${ONLINE_SOURCE.siteUrl}characters/ratlover/adventure-awaits`);
  check("非法 path 不给地址", onlineCardPngUrl("../etc") === null);
  check("空 path 不给地址", onlineCardPngUrl("") === null);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
