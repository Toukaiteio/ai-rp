/**
 * 逐项检查。
 *
 * 每项检查都是「块数组 + 少量上下文 → 问题列表」，纯函数、可单独测试。
 * 判定只用可数的证据（长度、标点、模式名、人名表），不做语义理解：
 * Phase 0 要的是稳定、可复现的基线，宁可标出可疑样本让人工看一眼，
 * 也不要一个每跑一次结果都不同的判官。
 *
 * 每个函数上方的注释写清楚「为什么算问题」，因为后面阶段要按这些码
 * 决定是自动修复还是直接判不合格。
 */
import { ACT_MAX_LENGTH, type MessageBlock } from "@/lib/blocks";
import { checkVoice, type CharacterVoiceProfile } from "@/lib/voice";
import type { GenerationIssue, IssueCode } from "./types";
import {
  countMatches,
  hanCount,
  kanaCount,
  normalizeForCompare,
  repeatedPhrases,
  snippet,
  splitClauses,
  stripQuoted,
} from "./text";

export interface CheckContext {
  /** 角色卡上的角色名 */
  cardName: string;
  /** 玩家称呼。出现在 who 里就算替玩家说话。 */
  userName: string;
  /** 已知人名（角色卡、记忆、历史里出现过的 who） */
  knownCharacters: string[];
  /** 玩家这一轮的输入 */
  playerInput: string;
  /** 上一轮 assistant 的原始输出 */
  previousReply: string;
  /**
   * 角色声音档案（Phase 9）。有它就检查对白有没有违背声明的禁令，
   * 没有就整项跳过——没写声音的卡不该被凭空判定。
   */
  voice?: CharacterVoiceProfile;
}

/* ------------------------------------------------------------------ act */

/** 心理与解释类词汇。act 里出现这些就说明它在解释，不是在白描。 */
const THOUGHT_MARKERS =
  /(?:心里|心中|内心|脑子里|觉得|感到|似乎|好像|仿佛|像是|因为|所以|为了|原来|其实|意识到|明白|担心|害怕|犹豫|不忍|忍住|忍不住|克制|打算|决定|记得|知道|想)/;

/** 说话类词汇。act 里出现这些就说明它在转述对白。 */
const SPEECH_MARKERS =
  /(?:说|问|答|回答|开口|补充|解释|喊|叫|念|低声|轻声|声音|语气|话音|嘟囔|嘀咕|重复)/;

/**
 * 动作串联词。act 里出现这些就说明它在写第二层动作。
 *
 * 「继续」不算：它修饰的是同一个动作（她继续擦杯子），不是第二个动作。
 * 这一点是真机跑批里抓到的误判——把「继续」当串联词会误伤大量正常 act。
 */
const CHAIN_MARKERS = /(?:然后|接着|随后|于是|一边|同时|之后|最终)/;

/** 「又」单独判：它既可能是「又倒了一杯」这种正常动作，也可能是「合上又翻开」。
 *  只有「又 + 动词」紧跟在另一个动作之后才算串联，所以交给 checkActMultiAction
 *  按分句和长度一起看，不在这里一刀切。 */
const CHAIN_REPEAT = /又[\u4e00-\u9fff]{0,4}(?:翻|合|开|关|抬|低|转|走|停|放|拿|起|坐|站)/;

/** 引号。act 里出现引号，几乎一定混进了对白。 */
const QUOTE_MARKS = /[「『“"][^」』”"]*[」』”"]/;

/**
 * act 过长：超过解析器允许的字符数。
 *
 * 为什么算问题：act 是界面上的一条即时动作，长了就会变成第二段旁白，
 * 玩家分不清哪句是世界、哪句是动作，后面阶段也没法把它当成「一个节拍」用。
 */
export function checkActLength(blocks: MessageBlock[]): GenerationIssue[] {
  const issues: GenerationIssue[] = [];
  blocks.forEach((block, index) => {
    if (block.kind !== "act") return;
    if (block.text.length <= ACT_MAX_LENGTH) return;
    issues.push({
      code: "act_overlong",
      severity: "warn",
      blockIndex: index,
      detail: `act 长度 ${block.text.length} 字，上限 ${ACT_MAX_LENGTH}`,
    });
  });
  return issues;
}

/**
 * act 含多个动作：用逗号、分号或串联词串起了两个以上动作中心。
 *
 * 为什么算问题：一个 act 只该是一帧画面。两帧以上要么该拆成两个块，
 * 要么该并进 narr——混在一起会让这一轮的动作节奏失控，玩家一次读到三件事。
 */
export function checkActMultiAction(blocks: MessageBlock[]): GenerationIssue[] {
  const issues: GenerationIssue[] = [];
  blocks.forEach((block, index) => {
    if (block.kind !== "act") return;
    const clauses = splitClauses(block.text);
    const chain = block.text.match(CHAIN_MARKERS) ?? block.text.match(CHAIN_REPEAT);
    if (clauses.length < 2 && !chain) return;
    issues.push({
      code: "act_multi_action",
      severity: "warn",
      blockIndex: index,
      detail: chain
        ? `act 用了串联词：${snippet(chain[0])}`
        : `act 含 ${clauses.length} 个动作分句`,
    });
  });
  return issues;
}

/**
 * act 混入对白：带引号，或者出现说话、语气、声音这类词。
 *
 * 为什么算问题：谁在说话由 dlg 负责。act 里塞对白会让界面漏掉说话人，
 * 也会让「这一轮角色到底开口没有」变得没法统计。
 */
export function checkActDialogue(blocks: MessageBlock[]): GenerationIssue[] {
  const issues: GenerationIssue[] = [];
  blocks.forEach((block, index) => {
    if (block.kind !== "act") return;
    const quoted = QUOTE_MARKS.test(block.text);
    const speaking = SPEECH_MARKERS.test(block.text);
    if (!quoted && !speaking) return;
    issues.push({
      code: "act_has_dialogue",
      severity: "warn",
      blockIndex: index,
      detail: quoted ? "act 里带引号" : `act 里出现说话类词：${snippet(block.text.match(SPEECH_MARKERS)?.[0] ?? "")}`,
    });
  });
  return issues;
}

/**
 * act 混入心理解释：出现了推断、原因、情绪命名或评价。
 *
 * 为什么算问题：act 是旁观者能拍下来的画面。写了「她犹豫了一下，因为不想说」
 * 就不再是画面，而是讲述者在替角色解释，这正是「act 不自然」的主要来源。
 */
export function checkActThought(blocks: MessageBlock[]): GenerationIssue[] {
  const issues: GenerationIssue[] = [];
  blocks.forEach((block, index) => {
    if (block.kind !== "act") return;
    const hit = stripQuoted(block.text).match(THOUGHT_MARKERS);
    if (!hit) return;
    issues.push({
      code: "act_has_thought",
      severity: "warn",
      blockIndex: index,
      detail: `act 里出现心理或解释类词：${hit[0]}`,
    });
  });
  return issues;
}

/* ------------------------------------------------------------------ dlg */

/** dlg 里的舞台指示：括号、星号包起来的动作。 */
const DLG_STAGE_DIRECTION = /[（(][^）)]{1,40}[）)]|\*[^*\n]{1,40}\*/;

/**
 * dlg 开头的转述句式：先写谁做了什么，再引出话。
 *
 * 主语只认代词和「已知人名」，不能写成任意两到四个汉字：
 * 「要喝热的就坐下」里的「要喝热」会被当成主语，把一句正常的招呼判成叙述。
 * 真机跑批里就是这么误判的，所以主语表由调用方按角色名传进来。
 */
const DLG_NARRATION_ACTION =
  /(?:又|也|只|才|就|便)?(?:笑了笑|笑|叹气|叹了口气|点头|摇头|沉默|停顿|顿了顿|皱眉|抬眼|低头|转身|回头|伸手|坐下|站起|愣|怔)/;

const DLG_SUBJECTS = ["她", "他", "它", "对方", "那人", "这人", "这个人", "那个人"];

/**
 * dlg 混入动作：对白块里出现了舞台指示或转述句式。
 *
 * 为什么算问题：dlg 只放角色说出口的原话，前端会把它当纯对白渲染。
 * 动作混进来以后，玩家看到的是「角色把旁白念了出来」。
 */
export function checkDialogueAction(
  blocks: MessageBlock[],
  names: string[] = [],
): GenerationIssue[] {
  const issues: GenerationIssue[] = [];
  const subjects = [...DLG_SUBJECTS, ...names.map((name) => name.trim()).filter(Boolean)];
  const narrationHead = subjects.length
    ? new RegExp(`^(?:${subjects.map(escapeRegExp).join("|")})${DLG_NARRATION_ACTION.source}`)
    : null;

  blocks.forEach((block, index) => {
    if (block.kind !== "dlg") return;
    const stage = block.text.match(DLG_STAGE_DIRECTION);
    if (stage) {
      issues.push({
        code: "dlg_has_action",
        severity: "warn",
        blockIndex: index,
        detail: `dlg 里有舞台指示：${snippet(stage[0])}`,
      });
      return;
    }
    const narration = narrationHead ? stripQuoted(block.text).match(narrationHead) : null;
    if (!narration) return;
    issues.push({
      code: "dlg_has_action",
      severity: "warn",
      blockIndex: index,
      detail: `dlg 开头是转述句式：${snippet(narration[0])}`,
    });
  });
  return issues;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ------------------------------------------------------------------ act：比喻与结果 */

/**
 * 文学化比喻：明喻、拟人、象征。
 *
 * 为什么算问题：act 是旁观者能拍下来的一帧。写了「像一片落叶」，
 * 画面就变成了修辞，玩家读到的是讲述者在点评，不是角色在动。
 */
const ACT_METAPHOR =
  /(?:像|仿佛|似乎|宛如|犹如|好似|如同|好比)[\u4e00-\u9fff]{1,10}|(?:一般|似的|一样)(?:地|的)?|(?:诉说|低语|歌唱|哭泣|叹息|呐喊|跳舞)/;

/**
 * 动作造成的结果：做完之后世界变成了什么样。
 *
 * 为什么算问题：结果属于 narr。写进 act 就等于把两帧塞进一帧，
 * 而且往往顺带解释了因果，读起来像说明而不是画面。
 *
 * 判据刻意收紧，只认三种形态，避免把正常动作误判成结果：
 * 1. 因果词开头（结果/弄得/使得/害得）；
 * 2. 「把某物碰/打/撞/推/踢/踩 + 倒/翻/洒/碎/掉/灭/湿/坏 + 了」——
 *    动作本身加一个被改变的状态；
 * 3. 状态词收在句末（洒了、碎了、灭了…），「她倒了半碗热水」这种
 *    正常动作不会命中，因为后面还有宾语。
 */
const ACT_RESULT =
  /(?:结果|弄得|使得|害得)[\u4e00-\u9fff]{0,10}|把[\u4e00-\u9fff]{1,6}(?:碰|打|撞|推|弄|踢|踩|扫)(?:倒|翻|洒|碎|掉|灭|湿|坏)了?|(?:洒了|溅了|碎了|灭了|湿了|断了|掉了)(?=[。！？，,；;]|$)/;

export function checkActMetaphor(blocks: MessageBlock[]): GenerationIssue[] {
  const issues: GenerationIssue[] = [];
  blocks.forEach((block, index) => {
    if (block.kind !== "act") return;
    const hit = stripQuoted(block.text).match(ACT_METAPHOR);
    if (!hit) return;
    issues.push({
      code: "act_metaphor",
      severity: "warn",
      blockIndex: index,
      detail: `act 里出现比喻或拟人：${snippet(hit[0], 10)}`,
    });
  });
  return issues;
}

export function checkActResult(blocks: MessageBlock[]): GenerationIssue[] {
  const issues: GenerationIssue[] = [];
  blocks.forEach((block, index) => {
    if (block.kind !== "act") return;
    const hit = stripQuoted(block.text).match(ACT_RESULT);
    if (!hit) return;
    issues.push({
      code: "act_result",
      severity: "warn",
      blockIndex: index,
      detail: `act 里写了动作结果：${snippet(hit[0], 10)}`,
    });
  });
  return issues;
}

/* ------------------------------------------------------------------ dlg：标签与 JSON */

/** 出现在对白里的 XML 标签或 JSON 片段。 */
const DLG_XML_TAG = /<\/?\s*[a-zA-Z_][\w-]*\s*[^>]*>/;
/**
 * JSON 片段：对象、数组或「键: 值」。
 * 只认成对的花括号和方括号，以及带引号的键——普通台词里的书名号、
 * 引号、「我知道了」这类内容不能误伤。
 */
const DLG_JSON =
  /[{[]\s*"[^"\n]{1,24}"\s*:|\{\s*"[^"\n]{1,24}"\s*:|"[^"\n]{1,24}"\s*:\s*(?:"[^"\n]{0,40}"|\d+|true|false|null|\{|\[)/;

/**
 * dlg 里混进标签或 JSON：模型把结构化输出漏进了台词。
 *
 * 为什么算问题：这类内容会原样进历史，下一轮被自己模仿；
 * 而且它根本不可能是角色说出口的话，所以判 hard，不试图改写。
 */
export function checkDialogueMarkup(blocks: MessageBlock[]): GenerationIssue[] {
  const issues: GenerationIssue[] = [];
  blocks.forEach((block, index) => {
    if (block.kind !== "dlg") return;
    const tag = block.text.match(DLG_XML_TAG);
    if (tag) {
      issues.push({
        code: "dlg_markup",
        severity: "block",
        blockIndex: index,
        detail: `dlg 里出现标签：${snippet(tag[0], 16)}`,
      });
      return;
    }
    const json = block.text.match(DLG_JSON);
    if (!json) return;
    issues.push({
      code: "dlg_markup",
      severity: "block",
      blockIndex: index,
      detail: `dlg 里出现 JSON 片段：${snippet(json[0], 16)}`,
    });
  });
  return issues;
}

/* ------------------------------------------------------------------ who 合法性 */

/** 代词。who 只能写名字，不能写「她」「那个人」。 */
const PRONOUN_WHO =
  /^(?:她|他|它|祂|她们|他们|它们|我|我们|你|你们|那个人|这个人|那人|这人|对方|某人|有人|众人|大家|旁人|那个人|那个女人|那个男人)$/;

/** 把 who 归一化，便于和角色名比对：去掉空白、括号注解和称呼后缀。 */
function normalizeWho(who: string): string {
  return who
    .replace(/[\s　]+/g, "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/(?:小姐|先生|女士|同学|老师|老板|老板娘|大人|阁下|さん|ちゃん|君)$/u, "");
}

/**
 * who 用了代词，或者和角色名对不上。
 *
 * 为什么算问题：who 决定头像、名牌和「谁在说话」。写成「她」时前端只能
 * 退回默认角色，写成外号时同一句话会挂到另一个人名下。两者都判 hard：
 * 改写 who 需要猜说话人，猜错比拒绝更糟。
 */
export function checkWho(
  blocks: MessageBlock[],
  context: CheckContext,
): GenerationIssue[] {
  const issues: GenerationIssue[] = [];
  const cardName = normalizeWho(context.cardName);
  // 只有角色卡上那个角色、玩家、以及已经出场过的人可以出现在 who 里。
  // 归一化后仍与角色名相同的人（外号、加注解）由下面的 who_inexact 单独判，
  // 所以这里先用原始名做「已知」判定。
  const known = new Set(
    [context.cardName, context.userName, ...context.knownCharacters]
      .map((name) => normalizeWho(name).toLowerCase())
      .filter(Boolean),
  );

  blocks.forEach((block, index) => {
    if (block.kind !== "dlg" && block.kind !== "act") return;
    const who = block.who?.trim();
    if (!who) return;

    if (PRONOUN_WHO.test(who)) {
      issues.push({
        code: "who_pronoun",
        severity: "block",
        blockIndex: index,
        detail: `${block.kind} 的 who 是代词「${snippet(who, 6)}」`,
      });
      return;
    }

    // 先看原始写法是否和已知人名完全一致；一致就放行，
    // 免得「林晚晴」这种准确写法被下面的近似规则误判。
    if (known.has(who.toLowerCase())) return;

    const clean = normalizeWho(who);
    // 归一化之后才认识的：说明模型写的是外号、简称或加了注解，判 who_inexact。
    // 「当前角色名必须准确」是硬规则，因为前端按 who 匹配头像和名牌。
    if (known.has(clean.toLowerCase())) {
      issues.push({
        code: "who_inexact",
        severity: "block",
        blockIndex: index,
        detail: `${block.kind} 的 who「${snippet(who, 8)}」不是准确的角色名`,
      });
      return;
    }

    // 和当前角色名只差一点点（少一个字、多一层称呼）也判 who_inexact
    if (cardName && (cardName.includes(clean) || clean.includes(cardName))) {
      issues.push({
        code: "who_inexact",
        severity: "block",
        blockIndex: index,
        detail: `${block.kind} 的 who「${snippet(who, 8)}」与角色名「${snippet(context.cardName, 8)}」不完全一致`,
      });
      return;
    }

    issues.push({
      code: "character_drift",
      severity: "block",
      blockIndex: index,
      detail: `${block.kind} 的 who「${snippet(who, 8)}」不在已知人名里`,
    });
  });

  return issues;
}

/* ------------------------------------------------------------------ 玩家主权 */

/**
 * 玩家做动作的句式。narr / act 里出现就说明模型替他动了。
 *
 * 只认「你 +（可选副词）+ 明确动作」这一种形态，而且限定在句首或标点之后。
 * 副词只放少数几个（也、又、跟着、默默…），「你旁边坐下」这种
 * 「你 + 方位 + 别人做动作」不会被误判。
 * 「从你坐下起」「搁在你手边」这类间接提及不算——世界当然可以提到玩家，
 * 越界的是让玩家做他没做过的事。误判的代价是整轮被拒收，所以这里宁漏勿错。
 */
const PLAYER_ACTION =
  /(?:^|[。！？；;，,\s])你(?:也|又|便|就|才|再)?(?:跟着|默默|缓缓|慢慢|轻轻|顺势|随后|不由得|忍不住)?(?:点了点头|点点头|摇头|转身|回头|伸手|抬手|站起|站起来|坐下|走了|走向|看向|抬头|低头|笑了|叹气|沉默|皱眉|愣住|开口|拿起|放下|接过|推开|闭上|睁开|迈开)/;

/** 玩家的心情与判断。规则里明确禁止代写。 */
const PLAYER_FEELING =
  /(?:^|[。！？；;，,\s])你(?:也|又|便|就|才|再)?(?:跟着|默默|缓缓|慢慢|轻轻|顺势|随后)?(?:感到|觉得|意识到|明白|知道|心里|心中|想起|记得|决定|打算|忍不住|不由得)/;

const PLAYER_NAMES = ["你", "玩家", "player", "user"];

/**
 * 替玩家说话或行动：出现玩家名下的块，或者旁白/动作里替玩家做了事。
 *
 * 为什么算问题：这是本项目最硬的一条底线。第一人称只属于玩家，
 * 一旦模型替他行动，后面所有轮次都建立在「玩家没做过的事」上面，
 * 上下文已经被污染了，所以判定为 block，不该写进历史。
 */
export function checkPlayerControl(
  blocks: MessageBlock[],
  context: CheckContext,
): GenerationIssue[] {
  const issues: GenerationIssue[] = [];
  const names = new Set(
    [...PLAYER_NAMES, context.userName.trim()].filter(Boolean).map((name) => name.toLowerCase()),
  );

  blocks.forEach((block, index) => {
    const who = block.who?.trim();
    if (who && names.has(who.toLowerCase())) {
      issues.push({
        code: "player_control",
        severity: "block",
        blockIndex: index,
        detail: `${block.kind} 块挂了玩家名「${snippet(who, 8)}」`,
      });
      return;
    }
    if (block.kind !== "narr" && block.kind !== "act" && block.kind !== "scene") return;
    const text = stripQuoted(block.text);
    const action = text.match(PLAYER_ACTION);
    if (action) {
      issues.push({
        code: "player_control",
        severity: "block",
        blockIndex: index,
        detail: `${block.kind} 里替玩家做动作：${snippet(action[0], 10)}`,
      });
      return;
    }
    const feeling = text.match(PLAYER_FEELING);
    if (feeling) {
      issues.push({
        code: "player_control",
        severity: "block",
        blockIndex: index,
        detail: `${block.kind} 里替玩家写心情：${snippet(feeling[0], 10)}`,
      });
    }
  });

  return issues;
}

/* ------------------------------------------------------------------ 复读 */

/**
 * 重复上一轮表达：和上一轮回复有 8 字以上的逐字重合。
 *
 * 为什么算问题：复读是「坏回复污染上下文」最常见的形态。模型把自己上一轮的
 * 句子再说一遍，下一轮再看到这两段，措辞会越收越窄，最后只剩几个固定句式。
 */
export function checkRepeat(
  blocks: MessageBlock[],
  context: CheckContext,
): { issues: GenerationIssue[]; count: number } {
  if (!context.previousReply.trim()) return { issues: [], count: 0 };

  const current = blocks
    .filter((block) => block.kind !== "player")
    .map((block) => block.text)
    .join("\n");
  const phrases = repeatedPhrases(current, context.previousReply, 8);
  if (phrases.length === 0) return { issues: [], count: 0 };

  const issues: GenerationIssue[] = phrases.map((phrase) => ({
    code: "repeated_expression" as IssueCode,
    severity: "warn" as const,
    detail: `与上一轮逐字重合 ${phrase.length} 字：${snippet(phrase)}`,
  }));
  return { issues, count: phrases.length };
}

/* ------------------------------------------------------------------ 剧情推进 */

/** 收束类词。和长回复一起出现时，说明这一轮把剧情做完了。 */
const RESOLUTION_MARKERS = /(?:从此|再也没|再也|终于|彻底|一切都|解决了|平静下来|结束了|就这样)/;

/** 一轮里最多允许的块数。超过就说明这一轮讲得太满。 */
export const MAX_BLOCKS_PER_TURN = 12;
/** 一轮里最多允许的场景切换块数。 */
export const MAX_SCENES_PER_TURN = 1;
/** 一轮回复的硬上限（可见字符）。超过就明显不是 150 到 300 字的节奏。 */
export const MAX_RESPONSE_LENGTH = 700;

/**
 * 一次性推进太多剧情：换场多次、块数过多，或者长回复里出现了收束词。
 *
 * 为什么算问题：这是「人物行为和剧情状态容易漂移」的前兆。一轮里把事情做完，
 * 下一轮没有可接的地方，模型只能另起一件事，人物就开始漂。
 */
export function checkPlotOverreach(
  blocks: MessageBlock[],
  responseLength: number,
): GenerationIssue[] {
  const issues: GenerationIssue[] = [];
  const scenes = blocks.filter((block) => block.kind === "scene").length;

  if (scenes > MAX_SCENES_PER_TURN) {
    issues.push({
      code: "plot_overreach",
      severity: "warn",
      detail: `一轮里换了 ${scenes} 次场`,
    });
  }
  if (blocks.length > MAX_BLOCKS_PER_TURN) {
    issues.push({
      code: "plot_overreach",
      severity: "warn",
      detail: `一轮 ${blocks.length} 个块，上限 ${MAX_BLOCKS_PER_TURN}`,
    });
  }

  const prose = blocks
    .filter((block) => block.kind === "narr" || block.kind === "scene")
    .map((block) => stripQuoted(block.text))
    .join("\n");
  const resolution = prose.match(RESOLUTION_MARKERS);
  if (resolution && responseLength > 300) {
    issues.push({
      code: "plot_overreach",
      severity: "warn",
      detail: `长回复里出现收束词：${snippet(resolution[0], 6)}`,
    });
  }

  return issues;
}

/**
 * 回复过长：可见正文远超约定的 150 到 300 字。
 *
 * 为什么算问题：字数本身不是罪，但它是「这一轮讲太满」最直接的证据，
 * 而且和 act 过长、一次解决剧情高度相关。单独记一个码，方便后面按字数调。
 */
export function checkResponseLength(responseLength: number): GenerationIssue[] {
  if (responseLength <= MAX_RESPONSE_LENGTH) return [];
  return [
    {
      code: "response_overlong",
      severity: "warn",
      detail: `可见正文 ${responseLength} 字，上限 ${MAX_RESPONSE_LENGTH}`,
    },
  ];
}

/* ------------------------------------------------------------------ 语言 */

/**
 * 角色语言切换错误：玩家用中文，角色却整句说日语或韩语。
 *
 * 为什么算问题：这是最容易被玩家一眼发现的出戏点。角色卡是日文名、
 * 示例对话是日文时尤其常见，所以这里按对白块单独判。
 */
export function checkLanguageSwitch(
  blocks: MessageBlock[],
  playerInput: string,
): GenerationIssue[] {
  const playerLang = detectPlayerLanguage(playerInput);
  if (playerLang !== "zh") return [];

  const issues: GenerationIssue[] = [];
  blocks.forEach((block, index) => {
    if (block.kind !== "dlg") return;
    const text = block.text;
    const kana = kanaCount(text);
    const total = hanCount(text) + kana;
    if (total === 0 || kana < 4 || kana / total < 0.2) return;
    issues.push({
      code: "language_switch",
      severity: "block",
      blockIndex: index,
      detail: `玩家用中文，dlg 里假名占 ${Math.round((kana / total) * 100)}%`,
    });
  });
  return issues;
}

function detectPlayerLanguage(playerInput: string): "zh" | "ja" | "ko" | "latin" | "unknown" {
  const text = playerInput.replace(/<\/?player\b[^>]*>/gi, "");
  const counts: Array<[string, number]> = [
    ["zh", hanCount(text)],
    ["ja", kanaCount(text)],
    ["ko", countMatches(text, /[\uac00-\ud7af]/g)],
    ["latin", countMatches(text, /[A-Za-z]/g)],
  ];
  const [top] = counts.sort((a, b) => b[1] - a[1]);
  return top && top[1] > 0 ? (top[0] as "zh" | "ja" | "ko" | "latin") : "unknown";
}

/* ------------------------------------------------------------------ 人设漂移 */

/**
 * 讲述者变成了角色：旁白、动作或场景块里出现第一人称。
 *
 * 为什么算问题：第一人称只属于玩家。讲述者写「我」就等于占了玩家的人物，
 * 后面每一轮都会沿着这个错误前提往下写，所以判 block。
 * who 的合法性由 checkWho 负责，这里只管叙述人称。
 */
export function checkNarratorPerson(blocks: MessageBlock[]): GenerationIssue[] {
  const issues: GenerationIssue[] = [];
  blocks.forEach((block, index) => {
    if (block.kind !== "narr" && block.kind !== "act" && block.kind !== "scene") return;
    if (!/我/.test(stripQuoted(block.text))) return;
    issues.push({
      code: "narrator_in_character",
      severity: "block",
      blockIndex: index,
      detail: `${block.kind} 里出现第一人称，讲述者变成了角色`,
    });
  });
  return issues;
}

/* ------------------------------------------------------------------ 文风 */

/** 破折号与说明文句式。规则里明确禁止。 */
const STYLE_BREACH = /(?:——|—)/;
const SUMMARY_TONE =
  /(?:总而言之|总之|这一切|就这样|从此|仿佛在诉说|似乎在诉说着|时间仿佛|空气中弥漫着|不禁让人|让人不由得)/;

/**
 * 违反文风硬规则：用了破折号，或者旁白写成总结、说明的口气。
 *
 * 为什么算问题：角色卡的文风要求只有变成可数的检查才会被真正遵守。
 * 破折号是硬规则，总结句是「act 内容不自然」的邻居症状，两个都记下来。
 */
export function checkStyle(blocks: MessageBlock[]): GenerationIssue[] {
  const issues: GenerationIssue[] = [];
  blocks.forEach((block, index) => {
    if (STYLE_BREACH.test(block.text)) {
      issues.push({
        code: "style_breach",
        severity: "warn",
        blockIndex: index,
        detail: `${block.kind} 里出现破折号`,
      });
    }
    if (block.kind !== "narr" && block.kind !== "scene") return;
    const hit = block.text.match(SUMMARY_TONE);
    if (!hit) return;
    issues.push({
      code: "summary_tone",
      severity: "warn",
      blockIndex: index,
      detail: `旁白像说明文：${snippet(hit[0], 8)}`,
    });
  });
  return issues;
}

/* ------------------------------------------------------------------ 角色声音 */

/**
 * 角色声音（Phase 9）。
 *
 * 只查**已经声明的禁令**：说了禁用表达、用了她会回避的话题、
 * 说了很多句却一次没用到口头禅。风格倾向（话短、情绪收着）不查——
 * 那种判断没有可靠标准，一查就是误报机器，而误报会拦住好回复。
 *
 * 严重度是 warn，GATE_ACTION 是 report：它只出现在开发面板里，
 * 不影响这一轮能不能进历史。
 */
export function checkVoiceBreach(
  blocks: MessageBlock[],
  profile: CharacterVoiceProfile | undefined,
): GenerationIssue[] {
  if (!profile) return [];

  const dialogue = blocks.filter((block) => block.kind === "dlg");
  if (dialogue.length === 0) return [];

  const violations = checkVoice(
    dialogue.map((block) => block.text),
    profile,
  );
  if (violations.length === 0) return [];

  // 挂到第一条对白上：面板里能顺着块下标找过去
  const firstDialogueIndex = blocks.findIndex((block) => block.kind === "dlg");
  return violations.map((violation) => ({
    code: "voice_breach" as const,
    severity: "warn" as const,
    blockIndex: firstDialogueIndex,
    detail: violation.detail,
  }));
}

/* ------------------------------------------------------------------ 协议 */

/** 认得出任何一个消息块标签，就算走了输出契约。 */
const BLOCK_TAG_PRESENT = /<\s*\/?\s*(narr|act|dlg|scene|player)\b/i;

/**
 * 没有输出消息块，把工具调用写成了标签，或者模型自己输出了 player 块。
 *
 * 为什么算问题：没有块标记说明模型完全没走输出契约（整段按 dlg 渲染，
 * 旁白和对白就分不开了）；把工具调用写成标签会原样进入历史，下一轮被自己模仿；
 * player 块是玩家主权的标记，模型输出它等于替玩家占位。三种都判 block。
 */
export function checkProtocol(
  raw: string,
  blocks: MessageBlock[],
  strippedLength: number,
  playerBlocks: number,
): GenerationIssue[] {
  const issues: GenerationIssue[] = [];
  if (raw.trim() && !BLOCK_TAG_PRESENT.test(raw)) {
    issues.push({
      code: "no_blocks",
      severity: "block",
      detail: "整段没有任何块标记，模型没走输出契约",
    });
  } else if (blocks.length === 0 && raw.trim()) {
    issues.push({
      code: "no_blocks",
      severity: "block",
      detail: "剥掉误写的标签后没有可渲染的内容",
    });
  }
  if (strippedLength > 0) {
    issues.push({
      code: "pseudo_tool_text",
      severity: "block",
      detail: `把工具调用写成了标签，剥掉 ${strippedLength} 字`,
    });
  }
  if (playerBlocks > 0) {
    issues.push({
      code: "player_block",
      severity: "block",
      detail: `模型输出了 ${playerBlocks} 个 player 块`,
    });
  }
  return issues;
}

/** 归一化后长度，用来判断剥标签前后有没有变化。 */
export function normalizedLength(raw: string): number {
  return normalizeForCompare(raw).length;
}
