# SillyTavern 特性移植说明

本文记录从酒馆（SillyTavern）移植或对照实现的特性：各自的语义来源、我们与它的差异、
以及刻意不移植的部分。引用一律指到酒馆仓库的具体文件，跟着版本走：
https://github.com/SillyTavern/SillyTavern

## 1. 世界书时效：sticky / cooldown / delay（已移植）

**酒馆语义**：`public/scripts/world-info.js`。条目激活后：

- `sticky: N` —— 本次激活后再保持 N 个 prompt 的激活态，期间不需要关键词再命中；
- `cooldown: N` —— sticky 窗口走完后，再压 N 个 prompt，期间关键词命中也不注入；
- `delay: N` —— 会话开头 N 个 prompt 不参与激活；
- 常驻条目（constant）不吃这三个字段。

**我们的实现**：`lib/prompt/worldbook.ts` 的 `matchWorldBook`，语义照搬，计数单位从
「prompt」换成「轮」（每次组装为一轮）。状态形状与生命周期：

- `LorebookTimingState`（`lib/prompt/types.ts`）：按 `来源#条目在书内的数组下标` 记
  `{ lastTurn, stickyLeft }`。下标作键与酒馆 UID 的行为一致，改动条目顺序会使记录错位，
  属已知取舍。
- `matchWorldBook` 返回本轮结束后的新状态；`assemble` 把它放进 `AssembleResult.lorebookTiming`，
  调用方（`components/chat/ChatScreen.tsx`）原样带回下一轮，随会话落盘
  （`ChatSession.lorebookTiming`，`lib/storage/types.ts`）。
- sticky 续期**不刷新窗口**（不然条目会自己续命下去）；cooldown 从 sticky 窗口走完才开始算；
  sticky 续期不再掷 probability（上一轮既然激活了，这几轮保持）。
- 常驻条目、没有时效字段的书不产生状态，零开销。

**刻意不做**：酒馆的向量激活（Data Bank / Vector Storage，语义检索补关键词的盲区）。
它需要 embedding 模型和本地向量库，属于独立基建，这里不跟。关键词盲区暂时靠
`constant` 常驻条目兜底。

## 2. V3 角色卡：chara_card_v3（已移植，降级兼容）

**酒馆语义**：`src/endpoints/characters.js` 与 `public/scripts/chara-state.js`。
V3 PNG 把 JSON 放进 keyword 为 `ccv3` 的 tEXt 块（V2 是 `chara`），两块都在时 V3 优先。

**我们的实现**：

- `lib/cards/png.ts`：同时认 `chara` 和 `ccv3` 两块；`ccv3` 优先，`ccv3` 坏了退回 `chara`，
  只有 `ccv3` 的纯 V3 卡也能拆。
- `lib/cards/validate.ts`：`parseCharacterCard` 本来就按 `data` 字段解析，V3 与 V2 共享
  字段（name / description / character_book 等）直接可用。V3 独有字段（`assets`、
  `nickname`、`group_only_greetings`、`creator_notes_multilingual`、`source`）原样保留在
  `extensions._unmapped`，导出时带回去，不丢内容。`assets` 里 `type: "icon"` 的条目映射为
  本地立绘（`extensions._local.portraitUrl`），与 V2 的 `avatar_url` 同等待遇。
- 导出仍是 V2 形状：我们不做 V3 导出。卡导入后以我们的模型运作，再导出时 V2 的兼容面
  最大（所有客户端都认 V2）。

## 3. 群聊编排（评估后暂不移植）

**酒馆语义**：`public/scripts/group-chats.js`。一个会话挂多张卡，每轮按
「mention 触发 > talkativeness 权重 > 轮替」挑一个成员发言，成员的卡描述拼进共享上下文，
回复里可以有多个成员接力。

**评估结论：暂不移植。** 三个理由：

1. 它不是提示词层的一个函数，是一整块产品：成员管理界面、每会话多卡存储、发言调度、
   说话人标记协议（我们的 who 语义要跟着改），工作量相当于半个新项目。
2. 我们的「讲述者」定位（`lib/prompt/system.ts` 的 BASE_RULES）本来就允许群像：
   契约里明确「群像剧允许临时出现角色」。单卡讲述者演群像在评测里没有暴露漂移问题。
3. 真正的需求出现时，入口已经留好：讲述者口吻 + 说话人 who 协议 + 会话级世界书，
   群聊只是在这三者上加「成员表 + 调度器」。

要做的正确姿势（留给未来）：成员表放会话（`ChatSession.members: CharacterCardData[]`），
调度器是纯函数（输入成员表、近期消息、mention，输出本轮发言者），发言者那张卡的
description / personality 进前缀、其余成员压成一行名单进回合层。

## 4. 其他对照过的部分

- **采样器面板**：酒馆的全家桶采样器绑定在 text-completion 协议上；我们主走的
  chat-completions 协议只有 temperature / max_tokens / reasoning_effort 可调，没有移植面。
- **正则脚本 / Quick Reply / STscript**：脚本系统与「opinionated 默认值」的产品立场相抵，
  不移植。
- **总结扩展**：酒馆按块重写主摘要；我们的增量摘要（coveredIndex + 挂接不重写）+ 超预算
  合并压缩（`lib/prompt/summarize.ts` 的 `summaryOverBudget`）是更好的方案，不回退。
