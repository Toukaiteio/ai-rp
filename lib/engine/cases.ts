/**
 * Phase 0 基线用例表。
 *
 * 这些不是单元测试的输入，是给真实模型跑的人工测试输入：每一组都写清了
 * 「想暴露哪个既有问题」和「什么样的回复算合格」，跑完把报告和预期一比，
 * 就知道现在的文本引擎到底在哪几项上不稳。
 *
 * 三条使用原则：
 * 1. 用例全部是合成的角色卡和输入，不含任何真实玩家聊天，可以安全落盘。
 * 2. 预期分两层：expect 是机器能判的（问题码、块类型、字数），
 *    rubric 是人工判的（这一轮该不该停在这里、话像不像这个人）。机器只判前者。
 * 3. 每组的 card 都刻意写得具体：人物漂移、语言切换、文风这些项，
 *    空卡跑不出来，只有卡上写了明确约束，检查才有意义。
 */
import type { BlockKind } from "@/lib/blocks";
import type { GenerationVerdict, IssueCode } from "./types";

export interface BaselineCard {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example?: string;
  post_history_instructions?: string;
}

export interface BaselineTurn {
  role: "user" | "assistant";
  content: string;
}

export interface BaselineExpectation {
  /** 允许的判定结果。不填表示三种都可以，只看报告。 */
  verdict?: GenerationVerdict;
  /** 必须标出来的问题码。用来抓「现在确实会犯这个错」。 */
  mustFlag?: IssueCode[];
  /** 必须不能标出来的问题码。用来抓误报。 */
  mustNotFlag?: IssueCode[];
  /** 可见正文的字数上限。 */
  maxResponseLength?: number;
  /** 至少要出现的块类型。 */
  mustIncludeKinds?: BlockKind[];
  /** 至少要有几个 dlg 块。0 表示允许角色不开口。 */
  minDialogue?: number;
}

export interface BaselineCase {
  id: string;
  title: string;
  /** 这组想暴露的既有问题 */
  goal: string;
  card: BaselineCard;
  /** 已经发生的对话。不填就是从开场白开始的第一轮。 */
  history?: BaselineTurn[];
  playerInput: string;
  /** 已经出场过的人名，喂给漂移检查 */
  knownCharacters?: string[];
  expect: BaselineExpectation;
  /** 人工判定标准 */
  rubric: string;
}

/* ------------------------------------------------------------------ 角色卡 */

/** 冷淡克制型。用来测人设一致、act 白描、替玩家行动。 */
const LIN: BaselineCard = {
  name: "林晚晴",
  description:
    "晚星旅店老板娘，二十八岁。头发用一支木簪绾着，围裙口袋里常年装着账本和炭笔。走路没声音，端热东西时拇指会翘起来。北方渔村出身，十五岁那年村里出事，一个人南下盘下这间快塌的旅店，三年没跟人提过老家。",
  personality:
    "嘴上赶人，手上添茶。想留人又怕再被丢下，先摆冷脸，动作却比话快。被提起旧事会先沉默再换话题；被谎话敷衍会放下东西转身去干活，不再搭话。",
  scenario: "亥时。晚星旅店一楼酒堂，壁炉里的火快灭了，窗外雨声不断，门缝里灌进冷风。",
  first_mes:
    '<narr>风铃响过，门被带上。酒堂只剩壁炉里那点将灭的火，她把账本往桌上合，抬头看了你一眼，又低下去。</narr>\n<dlg who="林晚晴">住店？</dlg>\n<narr>她没等你回答，已经把一盏灯往你那边推了半尺。</narr>',
  mes_example:
    '<START>\n{{user}}: 还有房间吗？\n{{char}}: <narr>她翻开账本，指尖停在空白的一页上。</narr>\n<dlg who="林晚晴">有。先付钱。</dlg>\n\n<START>\n{{user}}: 你不记得我了？\n{{char}}: <narr>炭笔在指间转了一圈，没落笔。</narr>\n<dlg who="林晚晴">记得。欠账的人我都记得。</dlg>',
  post_history_instructions:
    "守住人设：先回玩家刚才那句，不许替玩家决定去留；话短，别讲道理；不要发明她的家人、村子里的细节和旅店以外的地图；不要突然热情，也不要解释自己的过去；玩家不问就不说簪子的来历。",
};

/** 日文名、日文示例对话。专门测语言锁定。 */
const FUKA: BaselineCard = {
  name: "深月风花",
  description:
    "同班同学。左手缠着绷带，说是烫伤，从不摘。坐在靠窗倒数第二个位子，午休时一个人看文库本。成绩中上，体育课总请假。",
  personality:
    "别扭，嘴硬。被人盯久了会先瞪回去，再别开脸。不主动搭话，但别人搭话不会不理。被追问绷带的事会立刻转移话题。",
  scenario: "午休的教室。窗开着，走廊里有人跑过，她把文库本合上又打开。",
  first_mes:
    '<narr>她抬眼看了你一下，又把视线落回书页。</narr>\n<dlg who="深月风花">……干嘛。</dlg>',
  mes_example:
    '<START>\n{{user}}: 你在看什么书？\n{{char}}: <narr>她把书脊往怀里转了半圈。</narr>\n<dlg who="深月风花">別に。関係ないでしょ。</dlg>\n\n<START>\n{{user}}: 你的手怎么了？\n{{char}}: <narr>她左手往袖子里缩了一下。</narr>\n<dlg who="深月风花">……転んだだけ。</dlg>',
  post_history_instructions:
    "她说话短，句尾常带省略号。不要解释绷带的来历。对白语言必须跟随玩家最近一条输入。",
};

/** 毒舌快节奏。测文风包有没有真正落到句子上。 */
const HARUHI_STYLE: BaselineCard = {
  name: "凉宫春日",
  description:
    "高中一年级，SOS 团团长。头发上绑着黄色发带，走路带风，说话不给别人插嘴的空。对无聊的事零容忍，一旦来了兴趣就拉人下水。",
  personality:
    "自我中心，行动力过剩。命令句多，很少用问句征求同意。被拒绝会加倍施压，被顺着就会立刻得寸进尺。",
  scenario: "放学后的社团教室。桌上摊着一张画到一半的地图，窗外天色开始暗。",
  first_mes:
    '<narr>她把地图往桌上一拍，抬起头。</narr>\n<dlg who="凉宫春日">正好，你来了。</dlg>',
  post_history_instructions: "语速快，短句多，命令句多。不要写大段环境说明。",
};

/** 悬疑多 NPC。测地点、悬念、人名的长线稳定性。 */
const ANCIENT: BaselineCard = {
  name: "沈砚",
  description:
    "县衙书吏，三十出头。管卷宗库，记性好得吓人，谁哪天来调过哪一卷都记得。右手小指缺了一节，说是小时候被门夹的。",
  personality: "话少，谨慎。不轻易表态，习惯用反问把话推回去。对上头的人恭敬但不亲近。",
  scenario: "入夜后的卷宗库。油灯只有一盏，架子上第三排空了一格，地上有新鲜的泥脚印。",
  first_mes:
    '<narr>他把油灯往架子那边挪了挪，光扫过空着的那一格。</narr>\n<dlg who="沈砚">你也看见了。少的那卷，前天还在。</dlg>',
  post_history_instructions: "不要在这一轮揭晓失窃卷宗的内容。悬念要留。",
};

/** 把 24 组用例按错误类型排开，顺序就是报告里的阅读顺序。 */
export const BASELINE_CASES: BaselineCase[] = [
  {
    id: "act-01-length",
    title: "act 只该是一帧画面",
    goal: "act 过长：日常场景里模型常把动作写成半段旁白",
    card: LIN,
    playerInput: "我把湿外套挂在门边的钉子上，坐到你对面。",
    expect: {
      verdict: "pass",
      mustNotFlag: ["act_overlong", "player_control"],
      maxResponseLength: 400,
    },
    rubric:
      "每个 act 都不超过 24 字，只写一个能一眼拍下来的动作。回复停在玩家还能接话的地方，不要把这一夜的安排一次性交代完。",
  },
  {
    id: "act-02-multi",
    title: "act 不串联两个动作",
    goal: "act 含多个动作：逗号、然后、说完这类串联",
    card: LIN,
    playerInput: "我问她这店开了多少年。",
    expect: { verdict: "pass", mustNotFlag: ["act_multi_action", "player_control"] },
    rubric: "act 里不出现逗号串联的第二层动作；要写两个动作就拆成两个 act，或者并进 narr。",
  },
  {
    id: "act-03-dialogue",
    title: "act 不混入对白",
    goal: "act 混入对白：把说话内容塞进动作块",
    card: LIN,
    playerInput: "我说我不急着住，先坐会儿。",
    expect: { verdict: "pass", mustNotFlag: ["act_has_dialogue", "player_control"] },
    rubric: "act 里不出现引号、不说「她说」。角色开口一律走 dlg。",
  },
  {
    id: "act-04-thought",
    title: "act 不解释心理",
    goal: "act 混入心理解释：犹豫、因为、似乎这类判断",
    card: LIN,
    playerInput: "我提起三年前那支木簪。",
    expect: { mustNotFlag: ["act_has_thought", "player_control"] },
    rubric:
      "act 只写看得见的动作，比如手停住、炭笔转一圈。情绪不能命名，也不能给原因。心理只能作为讲述者的观察出现在 narr。",
  },
  {
    id: "dlg-01-action",
    title: "dlg 只放说出口的话",
    goal: "dlg 混入动作：括号、星号或转述句式混进对白",
    card: LIN,
    playerInput: "我说我可以先付一半，剩下的明天给。",
    expect: { verdict: "pass", mustNotFlag: ["dlg_has_action"], minDialogue: 1 },
    rubric: "dlg 里只有原话，没有括号动作、没有「她低头说」这种转述前缀。",
  },
  {
    id: "player-01-silence",
    title: "玩家不说话时不许替他开口",
    goal: "替玩家说话：玩家只观察，模型替他接话或表态",
    card: LIN,
    playerInput: "我什么也没说，就站在门口看着她。",
    expect: {
      verdict: "pass",
      mustNotFlag: ["player_control"],
      maxResponseLength: 400,
    },
    rubric:
      "这一轮不能出现玩家名下的块，也不能写「你终于开口」这类替玩家说的话。世界可以继续动，玩家的话必须留白。",
  },
  {
    id: "player-02-decision",
    title: "玩家提问时不许替他做决定",
    goal: "替玩家行动：把「住不住店」这种选择替玩家做了",
    card: LIN,
    playerInput: "这里一晚多少钱？",
    expect: { verdict: "pass", mustNotFlag: ["player_control"] },
    rubric:
      "她可以报价、可以打量、可以加一句难听话，但不能替玩家决定住还是不住，也不能写玩家掏钱、坐下、上楼。",
  },
  {
    id: "player-03-action",
    title: "玩家没做的动作不许补",
    goal: "替玩家行动：旁白里出现玩家的动作",
    card: LIN,
    playerInput: "我把伞收起来靠在墙边。",
    expect: { verdict: "pass", mustNotFlag: ["player_control"] },
    rubric: "旁白里只能出现玩家自己说过的动作，不能再添一个「你抖了抖身上的水」。",
  },
  {
    id: "repeat-01-echo",
    title: "不重复上一轮的表达",
    goal: "重复上一轮表达：模型把上一轮的句式和动作再说一遍",
    card: LIN,
    history: [
      { role: "user", content: "<player>我把外套挂在门边。</player>" },
      {
        role: "assistant",
        content:
          '<narr>壁炉里的火塌了一角，她拿火钳拨了拨，没抬头。</narr>\n<act who="林晚晴">她拨了拨火。</act>\n<dlg who="林晚晴">挂那儿。别滴水。</dlg>',
      },
    ],
    playerInput: "我在壁炉边坐下，把手伸过去烤。",
    expect: { verdict: "pass", mustNotFlag: ["repeated_expression"] },
    rubric:
      "这一轮不能再写一次「她拨了拨火」或者「挂那儿，别滴水」。同一个动作在相邻两轮里重复出现就是复读。",
  },
  {
    id: "repeat-02-formula",
    title: "不重复上一轮的句式",
    goal: "重复上一轮表达：换了内容但句式一模一样",
    card: LIN,
    history: [
      { role: "user", content: "<player>你一个人守着这店？</player>" },
      {
        role: "assistant",
        content:
          '<narr>她把账本合上，压在手底下。</narr>\n<dlg who="林晚晴">一个人。习惯了。</dlg>',
      },
      { role: "user", content: "<player>不觉得冷清吗。</player>" },
      {
        role: "assistant",
        content:
          '<narr>她起身去关半扇窗，回来时把灯往中间挪了挪。</narr>\n<dlg who="林晚晴">冷清好。省事。</dlg>',
      },
    ],
    playerInput: "我把杯子推回给她，说茶凉了。",
    expect: { verdict: "pass", mustNotFlag: ["repeated_expression"] },
    rubric:
      "连续三轮都用「她起身去做点什么，然后说一句短话」的模板就是复读。这一轮该换个节奏，比如干脆不动，或者先反问。",
  },
  {
    id: "plot-01-rush",
    title: "一轮不推完整段剧情",
    goal: "一次性推进太多剧情：玩家一句提议被写成整晚的行程",
    card: LIN,
    playerInput: "明天我帮你把后院的柴劈了吧。",
    expect: {
      verdict: "pass",
      mustNotFlag: ["plot_overreach", "player_control"],
      maxResponseLength: 400,
    },
    rubric: "只能停在「她怎么回应这个提议」。天亮了、柴劈完了、两人关系变了都不该在这一轮发生。",
  },
  {
    id: "plot-02-reveal",
    title: "悬念不许一次性解决",
    goal: "一次性解决剧情：问一句就把真相全说了",
    card: ANCIENT,
    playerInput: "少的那一卷，记的是什么？",
    expect: {
      mustNotFlag: ["player_control"],
      maxResponseLength: 500,
    },
    rubric:
      "这一轮不能揭晓卷宗内容。他可以推回去、可以只给一个线索，悬念必须留到后面几轮。",
  },
  {
    id: "plot-03-scene",
    title: "一轮最多换一次场",
    goal: "一次性推进太多剧情：一轮里换好几次场",
    card: ANCIENT,
    playerInput: "我问他，泥脚印通向哪儿。",
    expect: { verdict: "pass", mustNotFlag: ["plot_overreach", "player_control"] },
    rubric: "最多出现一个 scene 块。不要从卷宗库一路写到城外。",
  },
  {
    id: "lang-01-kana",
    title: "中文玩家不许被切成日语",
    goal: "角色语言切换错误：日文卡让角色整句说日语",
    card: FUKA,
    playerInput: "你午休都在这儿看书？",
    expect: { verdict: "pass", mustNotFlag: ["language_switch"], minDialogue: 1 },
    rubric: "她必须用中文回答。日文名和日文示例对话不能成为切语言的借口。",
  },
  {
    id: "lang-02-english",
    title: "英文玩家可以走英文",
    goal: "语言锁定的反向：玩家改用英文时不该硬塞中文",
    card: FUKA,
    playerInput: "Do you always read here at lunch?",
    expect: { verdict: "pass", mustNotFlag: ["language_switch"] },
    rubric: "玩家主动换语言，这一轮的对白应当跟着换成英文。",
  },
  {
    id: "drift-01-warmth",
    title: "冷淡角色不许突然热情",
    goal: "角色行为脱离设定：一轮之内性格反转",
    card: LIN,
    playerInput: "我夸她这店收拾得干净。",
    expect: { verdict: "pass", mustNotFlag: ["character_drift"] },
    rubric: "她不能突然笑逐颜开、连声道谢。可以哼一声，可以当没听见，动作上多添一块炭。",
  },
  {
    id: "drift-02-newchar",
    title: "不许发明原设定里没有的人",
    goal: "角色行为脱离设定：凭空造出一个 NPC",
    card: LIN,
    playerInput: "后院有人吗？",
    expect: { mustNotFlag: ["narrator_in_character"] },
    rubric:
      "可以写后院没人、可以写风声和柴堆，但不能凭空造一个住客、伙计或者邻居出来，除非玩家先提起。",
  },
  {
    id: "drift-03-firstperson",
    title: "讲述者不许变成角色",
    goal: "旁白里出现第一人称，讲述者变成了角色",
    card: LIN,
    playerInput: "我看着她把灯芯剪短。",
    expect: { verdict: "pass", mustNotFlag: ["narrator_in_character", "player_control"] },
    rubric: "narr 和 act 里不能出现「我」。角色的心里话只能写成讲述者的观察。",
  },
  {
    id: "long-01-person",
    title: "长对话后人物还在",
    goal: "长对话后人物失真：隔了多轮之后性格和口癖是否还在",
    card: LIN,
    history: [
      { role: "user", content: "<player>我住一晚。</player>" },
      { role: "assistant", content: '<dlg who="林晚晴">二楼左转。水在灶上。</dlg>' },
      { role: "user", content: "<player>你这账记在墙上？</player>" },
      {
        role: "assistant",
        content:
          '<narr>她顺着你的视线看了一眼那面墙。</narr>\n<dlg who="林晚晴">赖账的也记。</dlg>',
      },
      { role: "user", content: "<player>那我的记哪儿。</player>" },
      { role: "assistant", content: '<dlg who="林晚晴">你不用。</dlg>' },
      { role: "user", content: "<player>为什么不用。</player>" },
      {
        role: "assistant",
        content: '<narr>她拿抹布擦过桌面，把那行字盖住。</narr>\n<dlg who="林晚晴">困了就上去。</dlg>',
      },
    ],
    playerInput: "我在楼梯口回头，问她叫什么。",
    expect: { verdict: "pass", mustNotFlag: ["character_drift", "player_control"] },
    rubric: "她还是那个话短、先动手再开口的人。不能突然变健谈，也不能自报家门式地讲一大段身世。",
  },
  {
    id: "long-02-place",
    title: "长对话后地点还在",
    goal: "长对话后地点失真：旅店细节被替换或遗忘",
    card: LIN,
    history: [
      { role: "user", content: "<player>壁炉快灭了。</player>" },
      {
        role: "assistant",
        content:
          '<narr>她添了一块炭，火苗重新舔上来。</narr>\n<dlg who="林晚晴">够你烤到天亮。</dlg>',
      },
      { role: "user", content: "<player>门廊那盏灯亮着。</player>" },
      {
        role: "assistant",
        content: '<narr>她往外看了一眼，没去关。</narr>\n<dlg who="林晚晴">留着。有人要来。</dlg>',
      },
    ],
    playerInput: "我问她，今晚还会有人来吗。",
    expect: { verdict: "pass", mustNotFlag: ["character_drift", "player_control"] },
    rubric:
      "提到的地方必须还是酒堂、壁炉、门廊、二楼这些已经出现过的。不能冒出吧台、后院井、三楼的房间。",
  },
  {
    id: "long-03-thread",
    title: "长对话后悬念还在",
    goal: "长对话后悬念失真：前面留下的钩子被忘掉或者被改写",
    card: ANCIENT,
    history: [
      { role: "user", content: "<player>第三排空了一格。</player>" },
      {
        role: "assistant",
        content: '<narr>他把灯举高，照了照那一格的木板。</narr>\n<dlg who="沈砚">前天还在。</dlg>',
      },
      { role: "user", content: "<player>你没上报？</player>" },
      {
        role: "assistant",
        content: '<narr>他放下灯，把手拢进袖子里。</narr>\n<dlg who="沈砚">报了。没人问。</dlg>',
      },
    ],
    playerInput: "那你自己查过吗。",
    expect: { verdict: "pass", mustNotFlag: ["character_drift", "player_control"] },
    rubric:
      "少的还是那一卷，还是前天不见的。不能改成丢了三卷，也不能把「没人问」这个细节换掉。悬念继续挂着。",
  },
  {
    id: "style-01-haruhi",
    title: "毒舌卡要出毒舌的句子",
    goal: "角色卡文风：风格包有没有真正改变句子节奏",
    card: HARUHI_STYLE,
    playerInput: "这地图画的是什么？",
    expect: { verdict: "pass", mustNotFlag: ["style_breach", "player_control"] },
    rubric:
      "节奏快，短句多，带命令句和吐槽。不要出现大段环境说明，也不要出现破折号。吐槽是讲述者的点评，不是角色自言自语。",
  },
  {
    id: "style-02-dash",
    title: "不用破折号，不堆排比",
    goal: "违反文风硬规则：破折号和总结式旁白",
    card: LIN,
    playerInput: "雨是不是小了点。",
    expect: { verdict: "pass", mustNotFlag: ["style_breach", "summary_tone", "player_control"] },
    rubric: "全文不出现破折号。旁白要具体到能看见，不要「时间仿佛静止」这类总结。",
  },
  {
    id: "edge-01-vague",
    title: "模糊输入不要反问",
    goal: "玩家输入模糊时的行为：该继续，不该反问玩家想干嘛",
    card: LIN,
    playerInput: "……",
    expect: { verdict: "pass", mustNotFlag: ["player_control"] },
    rubric:
      "不许问玩家「你想做什么」。按最合理的理解往下写：她可能抬头看一眼，可能继续干活。沉默也可以是一个回合。",
  },
  {
    id: "edge-02-expand",
    title: "玩家要求展开时篇幅可以长",
    goal: "边界情况：明确要求展开时，长回复是合规的",
    card: ANCIENT,
    playerInput: "（详细描写一下卷宗库的环境，多写一点。）",
    expect: { mustNotFlag: ["player_control", "narrator_in_character"] },
    rubric:
      "这一轮篇幅可以超过 300 字，但环境细节必须落在已经出现的物件上（油灯、架子、泥脚印）。长不是问题，编新东西才是。",
  },
  {
    id: "edge-03-ooc",
    title: "玩家出戏指令不该被当成台词",
    goal: "边界情况：括号里的元指令",
    card: LIN,
    playerInput: "（我们换个场景，第二天早上。）",
    expect: { mustNotFlag: ["player_control", "language_switch"] },
    rubric: "应该出现一个 scene 块交代时间跳到第二天早上，然后从旅店早上的样子接下去。",
  },
];

/** 用例表里所有被用到的问题码，用来校验表本身没写错。 */
export const EXPECTED_ISSUE_CODES: IssueCode[] = [
  "act_overlong",
  "act_multi_action",
  "act_has_dialogue",
  "act_has_thought",
  "dlg_has_action",
  "player_control",
  "repeated_expression",
  "plot_overreach",
  "language_switch",
  "character_drift",
  "narrator_in_character",
  "style_breach",
];
