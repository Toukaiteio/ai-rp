/**
 * Phase 12.1 评测集：50 组固定输入。
 *
 * 和 `lib/engine/cases.ts` 的 26 组基线用例分工不同：
 * 基线用例是**给真实模型跑的**，人工看回复质量；
 * 这里是**离线可跑的评测集**，用来在每次改提示词或引擎代码之后自动回归。
 * 所以每组都要能回答「哪一项指标会因此变差」。
 *
 * 12.1 列了 15 项：普通闲聊 / 模糊输入 / 情绪冲突 / 场景切换 / 多角色 / 长文本 /
 * 玩家拒绝 / 玩家沉默 / 追问伏笔 / 角色不愿回答 / 角色说话风格 /
 * 中英切换 / 附件输入 / 工具调用 / 重新生成。
 *
 * 其中「重新生成」是**动作**而不是输入类型，但它需要自己的用例
 * （被弃用的上一版 + 纠偏指令），所以单列一类。其余 14 项是输入类型。
 * 两类加起来覆盖 12.1 的全部要求。
 *
 * 每组都标了 `category` 和 `checks`——`checks` 说清这组该盯哪几项指标。
 * 跑批脚本按 checks 汇总，改坏了能直接指到类别。
 */
import type { BaselineCard } from "@/lib/engine/cases";

export const EVAL_CATEGORIES = [
  "smalltalk",
  "vague",
  "conflict",
  "scene-shift",
  "multi-character",
  "long-text",
  "player-refuse",
  "player-silence",
  "thread-callback",
  "reluctant",
  "voice",
  "language",
  "attachment",
  "tool-call",
  "regenerate",
] as const;

export type EvalCategory = (typeof EVAL_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<EvalCategory, string> = {
  smalltalk: "普通闲聊",
  vague: "模糊输入",
  conflict: "情绪冲突",
  "scene-shift": "场景切换",
  "multi-character": "多角色",
  "long-text": "长文本",
  "player-refuse": "玩家拒绝",
  "player-silence": "玩家沉默",
  "thread-callback": "追问伏笔",
  reluctant: "角色不愿回答",
  voice: "角色说话风格",
  language: "中文与英文输入切换",
  attachment: "附件输入",
  "tool-call": "工具调用",
  regenerate: "重新生成",
};

/** 这一组要盯的指标。和 `lib/eval/metrics.ts` 的 key 一一对应。 */
export type MetricKey =
  | "validBlockRatio"
  | "invalidActRatio"
  | "badWhoRatio"
  | "toolTagLeakRatio"
  | "playerControlRatio"
  | "characterDriftRatio"
  | "repeatedRatio"
  | "unsupportedSettingRatio"
  | "plotOverreachRatio"
  | "sceneLocationKept"
  | "timelineConsistent"
  | "characterStateKept"
  | "threadRetention";

export interface EvalCase {
  id: string;
  category: EvalCategory;
  title: string;
  card: BaselineCard;
  /** 已经发生的对话。不填就是从开场白开始的第一轮 */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  playerInput: string;
  knownCharacters?: string[];
  /** 这组要盯的指标 */
  checks: MetricKey[];
  /** 期望的行为，人读 */
  expect: string;
  /** 可选：这一轮带附件（图片/文档），只影响组装，不影响离线判定 */
  attachment?: { kind: "image" | "document"; note: string };
  /** 可选：这组跑的是重新生成路径 */
  regenerate?: { discard: string; note: string };
}

/* ------------------------------------------------------------------ 角色卡 */

const INNKEEPER: BaselineCard = {
  name: "林晚晴",
  description:
    "晚星旅店老板娘，二十八岁。头发用一支木簪绾着，围裙口袋里常年装着账本和炭笔。走路没声音，端热东西时拇指会翘起来。北方渔村出身，十五岁那年村里出事，一个人南下盘下这间快塌的旅店，三年没跟人提过老家。",
  personality:
    "嘴上赶人，手上添茶。想留人又怕再被丢下，先摆冷脸，动作却比话快。被提起旧事会先沉默再换话题。",
  scenario: "亥时。晚星旅店一楼酒堂，壁炉里的火快灭了，窗外雨声不断，门缝里灌进冷风。",
  first_mes:
    '<narr>风铃响过，门被带上。酒堂只剩壁炉里那点将灭的火，她把账本往桌上合，抬头看了你一眼，又低下去。</narr>\n<dlg who="林晚晴">住店？</dlg>',
  post_history_instructions:
    "守住人设：先回玩家刚才那句，不许替玩家决定去留；话短，别讲道理；不要发明她的家人、村子里的细节和旅店以外的地图。",
};

const ANCIENT: BaselineCard = {
  name: "沈砚",
  description:
    "国史馆修撰，三十一岁。指节上有常年握笔磨出的薄茧，衣袖总沾着一点墨。三年前奉旨整理前朝卷宗，从此话更少。",
  personality: "克制，答话前会先停半拍。涉及卷宗的事只说已经记下的，不猜。",
  scenario: "国史馆西阁。油灯两盏，架子从地堆到梁，地上有新的泥脚印。",
  first_mes:
    '<narr>西阁里只有灯芯偶尔爆一下。他把手里的卷宗合上，指腹在封皮上按了按。</narr>\n<dlg who="沈砚">找什么？</dlg>',
  post_history_instructions: "不要发明卷宗以外的设定。玩家不问就不主动交代三年前的事。",
};

const HARUHI_STYLE: BaselineCard = {
  name: "凉宫春日",
  description: "北高一年五班，SOS 团团长。马尾扎得很高，校服袖口永远卷到手肘。",
  personality: "想到什么说什么，句子短，命令句多。不解释，不铺垫，不道歉。",
  scenario: "放学后的部室。桌上摊着一张手绘地图，窗外的操场有人在跑步。",
  first_mes:
    '<narr>她把地图往桌上一拍，铅笔滚到桌沿停住。</narr>\n<dlg who="凉宫春日">看这个。</dlg>',
  post_history_instructions: "节奏快，短句多。不要大段环境说明，不要破折号。",
};

const TWO_GUESTS: BaselineCard = {
  name: "林晚晴",
  description:
    "晚星旅店老板娘，二十八岁。走路没声音，端热东西时拇指会翘起来。店里常年住着一个跑商的老周，和一个不肯说姓名的年轻女客。",
  personality: "嘴上赶人，手上添茶。对老周随意，对那个女客客气得有点远。",
  scenario: "晚星旅店一楼酒堂。老周在角落剥花生，女客坐在楼梯口第二级，没点灯。",
  first_mes:
    '<narr>老周把花生壳往桌角推了推。楼梯口那位没动，只是把膝盖抱紧了一点。</narr>\n<dlg who="林晚晴">都别吵。</dlg>',
  post_history_instructions: "场上有三个人。谁说话都要写清 who。不要让女客突然开口解释自己。",
};

const SAME_VOICE: BaselineCard = {
  name: "深月风花",
  description: "同班同学。左手缠着绷带，说是烫伤，从不摘。午休时一个人看文库本。",
  personality: "别扭，嘴硬。被人盯久了会先瞪回去，再别开脸。被追问绷带的事会立刻转移话题。",
  scenario: "午休的教室。窗开着，走廊里有人跑过。",
  first_mes:
    '<narr>她翻了一页，没抬头。窗外的风把书页掀起一角，她用手指压住。</narr>\n<dlg who="深月风花">……你又没事干了？</dlg>',
  post_history_instructions: "话短，先回避再回答。不主动提绷带和自己的过去。",
};

const ENGLISH_CARD: BaselineCard = {
  name: "Elena",
  description: "A lighthouse keeper on the northern coast. Keeps a ledger of every ship she has guided in.",
  personality: "Blunt, economical with words. Answers the question asked and nothing more.",
  scenario: "Night. The lamp room, glass fogged at the edges. The sea is loud below.",
  first_mes:
    "<narr>She wipes the glass with her sleeve and checks the wick.</narr>\n<dlg who=\"Elena\">You again.</dlg>",
  post_history_instructions: "Keep replies in the language the player used.",
};

/* ------------------------------------------------------------------ 用例表 */

export const EVAL_CASES: EvalCase[] = [
  /* ---- 普通闲聊 4 组 ---- */
  {
    id: "sm-01-room",
    category: "smalltalk",
    title: "问有没有房间",
    card: INNKEEPER,
    playerInput: "还有房间吗？",
    checks: ["validBlockRatio", "playerControlRatio", "sceneLocationKept"],
    expect: "简短回答，不替玩家决定住不住。可以顺手推一盏灯，但别写玩家接过来了。",
  },
  {
    id: "sm-02-weather",
    category: "smalltalk",
    title: "聊天气",
    card: INNKEEPER,
    playerInput: "这雨下了几天了？",
    checks: ["validBlockRatio", "playerControlRatio", "characterDriftRatio"],
    expect: "答一个具体的天数，别绕回玩家身上。话短，可以带一句手上的活。",
  },
  {
    id: "sm-04-price",
    category: "smalltalk",
    title: "问价钱",
    card: INNKEEPER,
    playerInput: "住一晚多少钱？",
    checks: ["validBlockRatio", "unsupportedSettingRatio"],
    expect: "给一个具体的数，别含糊过去。不要顺便发明旅店的经营规则。",
  },

  /* ---- 模糊输入 3 组 ---- */
  {
    id: "vg-01-ellipsis",
    category: "vague",
    title: "只打了省略号",
    card: INNKEEPER,
    playerInput: "……",
    checks: ["validBlockRatio", "playerControlRatio"],
    expect: "不许反问玩家想干嘛。沉默也可以是回合：她抬头看一眼，或者继续擦杯子。",
  },
  {
    id: "vg-02-nothing",
    category: "vague",
    title: "说「没什么」",
    card: INNKEEPER,
    playerInput: "没什么。",
    checks: ["validBlockRatio", "playerControlRatio"],
    expect: "按最合理的理解继续，不要追问玩家到底想说什么。",
  },
  {
    id: "vg-03-sigh",
    category: "vague",
    title: "只叹了口气",
    card: SAME_VOICE,
    playerInput: "（叹气）",
    checks: ["validBlockRatio", "playerControlRatio"],
    expect: "把叹气当成一个动作接住，别解读成玩家在难过。",
  },

  /* ---- 情绪冲突 4 组 ---- */
  {
    id: "cf-01-accuse",
    category: "conflict",
    title: "指责她骗人",
    card: INNKEEPER,
    history: [
      { role: "assistant", content: '<dlg who="林晚晴">有。先付钱。</dlg>' },
      { role: "user", content: "你上次也是这么说的，结果那间屋子漏雨。" },
    ],
    playerInput: "你是不是又在骗我。",
    checks: ["playerControlRatio", "characterDriftRatio", "repeatedRatio"],
    expect: "她会硬碰硬或者转身去干活，但不会突然变得温顺解释。人设不能崩。",
  },
  {
    id: "cf-03-shout",
    category: "conflict",
    title: "冲她喊",
    card: SAME_VOICE,
    playerInput: "你到底在瞒什么！你手上那个到底是什么！",
    checks: ["characterDriftRatio", "playerControlRatio"],
    expect: "她会躲，会顶回来，或者沉默。不会一下子全说出来，也不会替玩家喊。",
  },
  {
    id: "cf-02-threat",
    category: "conflict",
    title: "威胁要拆穿她",
    card: INNKEEPER,
    playerInput: "我知道你老家的事，你要是不说我就讲出去。",
    checks: ["characterDriftRatio", "plotOverreachRatio", "unsupportedSettingRatio"],
    expect: "她的过去不能被这一句就逼出来。反应要落在当下（手停一下、不看他），不是交代往事。",
  },

  /* ---- 场景切换 4 组 ---- */
  {
    id: "ss-01-ooc-nextday",
    category: "scene-shift",
    title: "元指令换到第二天早上",
    card: INNKEEPER,
    playerInput: "（我们换个场景，第二天早上。）",
    checks: ["sceneLocationKept", "timelineConsistent", "validBlockRatio"],
    expect: "该出现 scene 块交代时间跳到早上，然后从旅店早上的样子接下去。",
  },
  {
    id: "ss-02-walk-out",
    category: "scene-shift",
    title: "走出旅店",
    card: INNKEEPER,
    playerInput: "我推门出去，站在雨里。",
    checks: ["sceneLocationKept", "characterStateKept"],
    expect: "地点该跟着变到门外，但正文要有交代。她可能追一句，也可能没动。",
  },
  {
    id: "ss-03-go-upstairs",
    category: "scene-shift",
    title: "上楼回房间",
    card: INNKEEPER,
    history: [{ role: "user", content: "房间在哪？" }],
    playerInput: "我先上去了。",
    checks: ["sceneLocationKept", "characterStateKept", "playerControlRatio"],
    expect: "她不该跟着上楼。场景可以留在酒堂，写她留在下面的样子。",
  },
  {
    id: "ss-04-skip-days",
    category: "scene-shift",
    title: "元指令跳三天",
    card: ANCIENT,
    playerInput: "（三天后，我再来一次西阁。）",
    checks: ["sceneLocationKept", "timelineConsistent", "plotOverreachRatio"],
    expect: "跳时间可以，但这三天里发生的事不能一次性交代完，也不能编新的事件。",
  },

  /* ---- 多角色 3 组 ---- */
  {
    id: "mc-01-two-voices",
    category: "multi-character",
    title: "场上有三个人",
    card: TWO_GUESTS,
    playerInput: "我问那个女客，她是从哪来的。",
    checks: ["badWhoRatio", "characterDriftRatio", "unsupportedSettingRatio"],
    expect: "三个人各有各的 who。女客不该突然开口解释自己的来历。",
  },
  {
    id: "mc-02-side-talk",
    category: "multi-character",
    title: "只跟老周说话",
    card: TWO_GUESTS,
    playerInput: "我坐到老周那桌，问他最近跑哪条线。",
    checks: ["badWhoRatio", "characterStateKept"],
    expect: "老周接话，老板娘可以有反应但别抢话。不要在 who 里写「他」。",
  },
  {
    id: "mc-04-new-person",
    category: "multi-character",
    title: "门口又进来一个人",
    card: TWO_GUESTS,
    playerInput: "门又响了，我回头看是谁。",
    checks: ["unsupportedSettingRatio", "badWhoRatio", "characterStateKept"],
    expect: "可以进一个新面孔，但要给具体的可见特征。不要直接塞一个有名有姓的旧相识。",
  },

  /* ---- 长文本 3 组 ---- */
  {
    id: "lt-01-backstory",
    category: "long-text",
    title: "玩家讲了一大段自己的身世",
    card: INNKEEPER,
    playerInput:
      "我告诉她，我小时候也在海边长大。我们家那条巷子尽头有一口井，井台上总是湿的，因为隔壁的老太太每天要打六趟水。后来我爹出海没回来，我娘就带着我搬走了，井的事我再也没跟人提过。",
    checks: ["repeatedRatio", "plotOverreachRatio", "validBlockRatio"],
    expect: "她的反应要短，要落在当下。不要顺着讲一段她自己的海边往事。",
  },
  {
    id: "lt-02-describe",
    category: "long-text",
    title: "要求详细描写环境",
    card: ANCIENT,
    playerInput: "（详细描写一下西阁的环境，多写一点。）",
    checks: ["unsupportedSettingRatio", "validBlockRatio"],
    expect: "可以超过 300 字，但细节要落在已有的物件上（油灯、架子、泥脚印）。长不是问题，编新东西才是。",
  },
  {
    id: "lt-03-recap",
    category: "long-text",
    title: "让角色复述之前发生的事",
    card: ANCIENT,
    history: [
      { role: "user", content: "丢的是什么？" },
      { role: "assistant", content: '<dlg who="沈砚">前朝的一卷。前天还在架上。</dlg>' },
    ],
    playerInput: "你把刚才说的再讲一遍，从头。",
    checks: ["repeatedRatio", "unsupportedSettingRatio", "timelineConsistent"],
    expect: "复述要和前面说的一致（一卷、前天），不能这次说成三卷、上个月。",
  },

  /* ---- 玩家拒绝 3 组 ---- */
  {
    id: "pr-01-refuse-room",
    category: "player-refuse",
    title: "拒绝住店",
    card: INNKEEPER,
    playerInput: "不住了，我就坐会儿。",
    checks: ["playerControlRatio", "characterDriftRatio"],
    expect: "她可能赶人，也可能随你。但不能替玩家决定「你最后还是住了」。",
  },
  {
    id: "pr-02-refuse-answer",
    category: "player-refuse",
    title: "拒绝回答她的问题",
    card: SAME_VOICE,
    history: [{ role: "assistant", content: '<dlg who="深月风花">你问这个干嘛。</dlg>' }],
    playerInput: "不告诉你。",
    checks: ["playerControlRatio", "characterDriftRatio"],
    expect: "她会不追问，或者换个方式。不要把玩家的拒绝解读成心虚。",
  },
  {
    id: "pr-03-leave",
    category: "player-refuse",
    title: "掉头就走",
    card: INNKEEPER,
    playerInput: "算了，我走了。",
    checks: ["playerControlRatio", "sceneLocationKept"],
    expect: "可以写她的反应，但不能写玩家「停住了」或者「又转回来」。",
  },

  /* ---- 玩家沉默 3 组 ---- */
  {
    id: "ps-01-blank",
    category: "player-silence",
    title: "空输入",
    card: INNKEEPER,
    playerInput: "",
    checks: ["validBlockRatio", "playerControlRatio"],
    expect: "把沉默写成一个回合：她等了一会儿，然后继续做自己的事。",
  },
  {
    id: "ps-02-dot",
    category: "player-silence",
    title: "只打了一个句号",
    card: ANCIENT,
    playerInput: "。",
    checks: ["validBlockRatio", "playerControlRatio"],
    expect: "同上。不要反问玩家在打什么。",
  },
  {
    id: "ps-03-wait",
    category: "player-silence",
    title: "明确说「我不说话，就看着」",
    card: SAME_VOICE,
    playerInput: "我不说话，就看着她。",
    checks: ["playerControlRatio", "characterDriftRatio"],
    expect: "她的反应是重点。玩家这一句已经是完整的动作，不要再替玩家加动作。",
  },

  /* ---- 追问伏笔 3 组 ---- */
  {
    id: "tc-01-hairpin",
    category: "thread-callback",
    title: "追问簪子",
    card: INNKEEPER,
    history: [
      { role: "user", content: "还有房间吗？" },
      { role: "assistant", content: '<dlg who="林晚晴">有。先付钱。</dlg>' },
    ],
    playerInput: "你那支簪子挺旧的，哪来的？",
    checks: ["characterDriftRatio", "plotOverreachRatio", "unsupportedSettingRatio"],
    expect: "她应该换话题或沉默。不能这一问就把簪子的来历全交代了。",
  },
  {
    id: "tc-02-ledger",
    category: "thread-callback",
    title: "追问账本上的名字",
    card: INNKEEPER,
    history: [
      { role: "assistant", content: '<narr>她把账本合上，压在手肘下面。</narr>' },
      { role: "user", content: "账本上写的什么？" },
    ],
    playerInput: "我刚才看见有个名字被划掉了，是谁？",
    checks: ["characterDriftRatio", "plotOverreachRatio"],
    expect: "她该把账本收得更紧。不能顺着编出一个具体的人名和故事。",
  },
  {
    id: "tc-03-scroll",
    category: "thread-callback",
    title: "追问丢的那一卷",
    card: ANCIENT,
    history: [
      { role: "assistant", content: '<dlg who="沈砚">前朝的一卷。前天还在架上。</dlg>' },
      { role: "user", content: "查出来了吗？" },
    ],
    playerInput: "那卷里写的是什么？",
    checks: ["unsupportedSettingRatio", "plotOverreachRatio", "timelineConsistent"],
    expect: "他可以说不知道，或者只说已经记下的。不能编出卷宗内容。",
  },

  /* ---- 角色不愿回答 4 组 ---- */
  {
    id: "ra-01-past",
    category: "reluctant",
    title: "问她老家",
    card: INNKEEPER,
    playerInput: "你老家是哪的？",
    checks: ["characterDriftRatio", "unsupportedSettingRatio"],
    expect: "答一个模糊的方向，或者直接岔开。不要给村名、年份、具体的人。",
  },
  {
    id: "ra-02-family",
    category: "reluctant",
    title: "问她家里人",
    card: INNKEEPER,
    playerInput: "你家里人呢，还在老家？",
    checks: ["characterDriftRatio", "plotOverreachRatio"],
    expect: "这一问不能问出她的家世。她该去干活，或者只回一句硬的。",
  },
  {
    id: "ra-03-three-years",
    category: "reluctant",
    title: "问三年前的事",
    card: ANCIENT,
    playerInput: "三年前你到底在查什么？",
    checks: ["characterDriftRatio", "plotOverreachRatio", "unsupportedSettingRatio"],
    expect: "他会停半拍，然后只说已经记下的。不能交代三年前的全貌。",
  },
  {
    id: "ra-04-why-here",
    category: "reluctant",
    title: "问女客为什么住这儿",
    card: TWO_GUESTS,
    playerInput: "我问老板娘，那个女客为什么一直住这儿。",
    checks: ["characterDriftRatio", "badWhoRatio", "unsupportedSettingRatio"],
    expect: "老板娘会挡回去。不要借她的口把女客的来历讲出来。",
  },

  /* ---- 角色说话风格 4 组 ---- */
  {
    id: "vo-01-short",
    category: "voice",
    title: "话短的人不该长篇大论",
    card: SAME_VOICE,
    playerInput: "今天怎么没去食堂？",
    checks: ["validBlockRatio", "characterDriftRatio"],
    expect: "对白要短。不能一次说三句以上，也不能开始讲道理。",
  },
  {
    id: "vo-02-haruhi",
    category: "voice",
    title: "毒舌卡要出毒舌的句子",
    card: HARUHI_STYLE,
    playerInput: "这地图画的是什么？",
    checks: ["validBlockRatio", "repeatedRatio"],
    expect: "短句多，带命令句和吐槽。不要大段环境说明，不要破折号。",
  },
  {
    id: "vo-03-restrained",
    category: "voice",
    title: "克制的人不该抒情",
    card: ANCIENT,
    playerInput: "外面雨停了。",
    checks: ["characterDriftRatio", "validBlockRatio"],
    expect: "他可以只「嗯」一声。不要突然写一段感慨。",
  },
  {
    id: "vo-04-consistent",
    category: "voice",
    title: "连续两轮风格不能变",
    card: SAME_VOICE,
    history: [
      { role: "user", content: "你在看什么书？" },
      { role: "assistant", content: '<dlg who="深月风花">……没什么。</dlg>' },
    ],
    playerInput: "那你为什么看得那么认真。",
    checks: ["characterDriftRatio", "repeatedRatio"],
    expect: "还是那个回避的调子，句长也差不多。不能这一轮突然话多又热情。",
  },

  /* ---- 中文与英文输入切换 3 组 ---- */
  {
    id: "lg-01-english",
    category: "language",
    title: "英文输入",
    card: ENGLISH_CARD,
    playerInput: "Who was the last ship you brought in?",
    checks: ["validBlockRatio", "characterDriftRatio"],
    expect: "回复用英文。不要因为角色卡里有中文就切成中文。",
  },
  {
    id: "lg-02-switch-back",
    category: "language",
    title: "从英文切回中文",
    card: ENGLISH_CARD,
    history: [
      { role: "user", content: "Who was the last ship?" },
      { role: "assistant", content: '<dlg who="Elena">A trawler. Three days ago.</dlg>' },
    ],
    playerInput: "那艘船后来去哪了？",
    checks: ["validBlockRatio", "characterDriftRatio"],
    expect: "跟着玩家切回中文。语言锁定看的是玩家最近一句。",
  },
  {
    id: "lg-03-mixed",
    category: "language",
    title: "中英混着说",
    card: INNKEEPER,
    playerInput: "I want a room，就一晚。",
    checks: ["validBlockRatio", "playerControlRatio"],
    expect: "按主要语言（中文）回。不要一半中文一半英文。",
  },
  {
    id: "lg-04-english-conflict",
    category: "language",
    title: "英文输入下的情绪冲突",
    card: ENGLISH_CARD,
    playerInput: "You knew the boat would sink. Why did you light the lamp?",
    checks: ["validBlockRatio", "characterDriftRatio", "plotOverreachRatio"],
    expect: "用英文顶回来，但不把整件事解释完。语言锁定和悬念保留要同时成立。",
  },

  /* ---- 附件输入 3 组 ---- */
  {
    id: "at-01-image",
    category: "attachment",
    title: "带一张图",
    card: INNKEEPER,
    playerInput: "我把这张画给她看。",
    attachment: { kind: "image", note: "一张旅店外观的速写" },
    checks: ["validBlockRatio", "unsupportedSettingRatio"],
    expect: "她该看图上的东西，不能凭空说出画里没有的细节。",
  },
  {
    id: "at-04-document-question",
    category: "attachment",
    title: "带文件并追问其中一项",
    card: ANCIENT,
    playerInput: "这份名单第三行那个名字，你认识吗？",
    attachment: { kind: "document", note: "一份十来个名字的名单，第三行是「周砚」" },
    checks: ["unsupportedSettingRatio", "playerControlRatio"],
    expect: "他可以说认识或不认识，但不能编出名单上没有的人或事。",
  },
  {
    id: "at-05-image-vague",
    category: "attachment",
    title: "带图但不说是什么",
    card: SAME_VOICE,
    playerInput: "（把手机递过去）",
    attachment: { kind: "image", note: "一张教室窗外的照片" },
    checks: ["playerControlRatio", "validBlockRatio"],
    expect: "她会看一眼，但不要替玩家解释这张图是什么。",
  },

  /* ---- 工具调用 3 组 ---- */
  {
    id: "tl-01-remember",
    category: "tool-call",
    title: "该记下新出现的人",
    card: INNKEEPER,
    playerInput: "我自我介绍了一下，说我叫阿川，是个走货的。",
    checks: ["toolTagLeakRatio", "validBlockRatio"],
    expect: "记人要走函数调用。正文里不能出现 remember_character 这样的字眼。",
  },
  {
    id: "tl-02-no-leak",
    category: "tool-call",
    title: "不要让工具调用漏进正文",
    card: ANCIENT,
    playerInput: "你还记得上次我来问过什么吗？",
    checks: ["toolTagLeakRatio", "validBlockRatio"],
    expect: "要么直接答，要么走 read_memory。正文里不能出现标签或 JSON。",
  },
  {
    id: "tl-03-dice",
    category: "tool-call",
    title: "该掷骰的时候掷骰",
    card: ANCIENT,
    playerInput: "我爬上架子去够最上面那卷。",
    checks: ["toolTagLeakRatio", "validBlockRatio"],
    expect: "要掷骰就走 roll_dice。不要把掷骰结果当成正文写出来。",
  },

  /* ---- 重新生成 4 组 ---- */
  {
    id: "rg-01-bad-act",
    category: "regenerate",
    title: "上一版 act 太长",
    card: SAME_VOICE,
    playerInput: "你手上那个到底怎么了。",
    regenerate: {
      discard:
        '<act who="深月风花">她先是低头看着自己的手，然后慢慢把袖子往下拉了一点，又像是想起什么似的把手缩回去放在膝盖上，最后别开脸看向窗外。</act>',
      note: "上一版 act 里塞了四个动作",
    },
    checks: ["invalidActRatio", "repeatedRatio"],
    expect: "重写之后 act 要短、只保留一个动作，而且不能复用上一版的表达。",
  },
  {
    id: "rg-02-player-control",
    category: "regenerate",
    title: "上一版替玩家行动",
    card: INNKEEPER,
    playerInput: "我坐下来。",
    regenerate: {
      discard: "<narr>你坐下来，觉得这间旅店让人安心，于是决定今晚就住在这里。</narr>",
      note: "上一版替玩家决定了住不住",
    },
    checks: ["playerControlRatio", "repeatedRatio"],
    expect: "重写之后不能出现玩家的决定和心情。",
  },
  {
    id: "rg-03-repeat",
    category: "regenerate",
    title: "上一版复读了前一轮",
    card: ANCIENT,
    history: [
      { role: "assistant", content: '<act who="沈砚">他把卷宗合上，指腹在封皮上按了按。</act>' },
      { role: "user", content: "还有别的吗？" },
    ],
    playerInput: "还有别的吗？",
    regenerate: {
      discard: '<act who="沈砚">他把卷宗合上，指腹在封皮上按了按。</act>\n<dlg who="沈砚">没有。</dlg>',
      note: "上一版和上一轮的动作一模一样",
    },
    checks: ["repeatedRatio", "invalidActRatio"],
    expect: "换一个动作写，别再用「合上卷宗、按封皮」。",
  },
  {
    id: "rg-04-too-long",
    category: "regenerate",
    title: "上一版太长",
    card: SAME_VOICE,
    playerInput: "你在看什么书？",
    regenerate: {
      discard: `<narr>窗外的风把窗帘掀起一角，又慢慢落回去。走廊里传来一阵脚步声，很快远去了。她把书翻过一页，目光在字上停了很久，像是在读，又像只是在看纸。</narr>`,
      note: "上一版整段都是环境描写",
    },
    checks: ["validBlockRatio", "repeatedRatio"],
    expect: "重写之后要短，重心落在她的反应上。",
  },
];

/** 用例表的自检：类别覆盖和 id 唯一，在测试里断言。 */
export function casesByCategory(): Record<EvalCategory, EvalCase[]> {
  const groups = Object.fromEntries(
    EVAL_CATEGORIES.map((category) => [category, [] as EvalCase[]]),
  ) as Record<EvalCategory, EvalCase[]>;
  for (const item of EVAL_CASES) groups[item.category].push(item);
  return groups;
}
