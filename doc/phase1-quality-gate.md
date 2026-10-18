# Phase 1：消息块质量门

Phase 0 只是把行为记下来。Phase 1 让「记下来的问题」真正产生后果：
**不合格的回复不再有机会进入历史。**

- 代码入口：`lib/engine/validate.ts`（校验 + 降级）、`lib/engine/history.ts`（写入决定）
- 接线位置：`components/chat/ChatScreen.tsx` 的 `runTurn` 收尾
- 测试：`lib/engine/validate.test.ts`（48 条）、`lib/engine/history.test.ts`（6 条）
- 真机结果：`doc/phase1-gate-baseline.json`

---

## 1. 纯函数：`validateResponseBlocks`

```ts
const validation = validateResponseBlocks(raw, {
  cardName: "林晚晴",
  userName: "你",
  knownCharacters: ["沈砚"],
  playerInput: "我把外套挂在门边。",
  previousReply: "<narr>…</narr>",
});
```

返回 `ResponseValidation`：

| 字段 | 含义 |
| --- | --- |
| `severity` | `none` / `soft` / `hard`，取所有问题里最重的那一档 |
| `decision` | `accepted` / `degraded` / `rejected` |
| `issues` | 全部结构问题 |
| `hardIssues` / `softIssues` | 按处理方式拆开的两组 |
| `rawBlocks` | 模型原始输出解析出的块（已剔除 player 块），指标和下标都以它为准 |
| `blocks` | 降级后的块，可直接渲染 |
| `content` | 可以写进历史的正文。`rejected` 时是空串 |
| `degradations` | 哪几个块被改写成了什么 |
| `reason` | 拒收时给玩家看的一句话 |

三条不变量：

1. **`rejected` 时 `content` 一定是空串。** 调用方不可能「顺手」把坏内容写进历史。
2. **`accepted` 时 `content` 是原始字符串本身**，不走 `blocksToRaw` 再序列化——
   合法回复一个字都不该动。
3. **硬错误优先。** 一旦有硬错误就不再降级：改出来的内容也不会被采用，白算一遍还可能掩盖问题。

## 2. 三档严重程度

```ts
type ValidationSeverity = "none" | "soft" | "hard";
```

处理方式不是写在检查里，而是集中在一张表（`types.ts` 的 `GATE_ACTION`）：

| 处理 | 问题码 | 落地方式 |
| --- | --- | --- |
| `degrade` | `act_overlong`、`act_multi_action`、`act_has_dialogue`、`act_has_thought`、`act_metaphor`、`act_result` | act 降级为 narr，保留原文，不触发修复请求 |
| `degrade` | `dlg_has_action` | 剥掉舞台指示，剩下的原话仍然是对白 |
| `reject` | `player_control`、`player_block`、`who_pronoun`、`who_inexact`、`character_drift`、`narrator_in_character`、`language_switch`、`dlg_markup`、`no_blocks`、`pseudo_tool_text` | 整轮拒收，不写历史 |
| `report` | `repeated_expression`、`plot_overreach`、`response_overlong`、`summary_tone`、`style_breach` | 只记录，不影响落地 |

`report` 这一档是刻意留的：复读、一次推太多剧情、破折号这些问题，
靠拒收解决不了，也修不动，硬拦只会让玩家反复重生成。它们交给后续阶段
（记忆、剧情线、文风）处理，这里只保证「不会悄悄消失」。

**为什么降级而不是整轮重写**：act 太长、dlg 里带了括号动作，内容本身是好的，
只是挂错了块。改块类型比重新生成便宜，也不会把这一轮已经发生的事再写一遍。
真正不能救的（替玩家行动、角色名不明、非法标签）才拒收——改写它们需要猜，
猜错比拒绝更糟。

## 3. 结构校验清单

### 块合法性

- 只接受 `narr` / `act` / `dlg` / `scene`。
- **模型输出 `<player>` 直接判硬错误**（`player_block`），并且 player 块会被剔除出
  `blocks`——它是玩家主权的标记，留着会被 `blocksToRaw` 原样写回历史。
- 整段没有任何块标记（`no_blocks`）判硬错误：整段会按对白渲染，旁白和对白就分不开了。

### who 合法性

| 情况 | 问题码 | 说明 |
| --- | --- | --- |
| `who="她" / "他" / "那个人" / "对方"` | `who_pronoun` | 代词不能当说话人 |
| `who="晚晴"`（卡上是「林晚晴」） | `who_inexact` | 外号、简称、加注解都不行 |
| `who="王掌柜"`（没登记过） | `character_drift` | 不许发明当前不存在的角色 |
| 省略 `who` | — | 按角色卡处理，合法 |

判定顺序：代词 → 与已知人名完全一致 → 归一化后一致（说明写了外号/注解）→
与角色名互为子串（少一个字）→ 都没命中就是凭空造人。
前端靠 `who` 匹配头像和名牌，所以「准确」是硬规则。

### act 合法性

| 检查 | 问题码 | 判据 |
| --- | --- | --- |
| 单一动作 | `act_multi_action` | 逗号/分号分出 ≥2 个分句，或出现「然后/接着/随后/继续/一边」；「合上又翻开」这类「又+动词」也算 |
| 长度 | `act_overlong` | 超过 `ACT_MAX_LENGTH`（24 字，与解析器共用） |
| 不含对白 | `act_has_dialogue` | 带引号，或出现「说/问/答/低声/语气/声音」 |
| 不含心理判断 | `act_has_thought` | 「心里/觉得/似乎/好像/因为/所以/犹豫/决定」 |
| 不含因果解释 | `act_has_thought` | 同上，「因为/所以/为了/原来」都在词表里 |
| 不含连续动作链 | `act_multi_action` | 串联词 + 多分句 |
| 不含文学化比喻 | `act_metaphor` | 明喻（像/仿佛/宛如/犹如）、「一般/似的/一样」、拟人（诉说/低语/歌唱） |
| 不含动作结果 | `act_result` | 因果词开头、把字句改变状态（碰倒/推洒）、状态词收句（…洒了/灭了） |

`act_result` 的判据刻意收紧：`她倒了半碗热水` 是动作不是结果，
因为后面还有宾语；只有 `她把杯子碰倒了` 这种「动作 + 被改变的状态」才算。

### dlg 合法性

| 检查 | 问题码 | 处理 |
| --- | --- | --- |
| 只包含说出口的话 | — | 这是总原则 |
| 括号动作 `（她低头）` | `dlg_has_action` | 剥掉 |
| 星号动作 `*叹气*` | `dlg_has_action` | 剥掉 |
| 「她笑了笑，」这类叙述前缀 | `dlg_has_action` | 剥掉 |
| 剥完什么都不剩 | `dlg_has_action` | 整块丢弃，记 `to: "dropped"` |
| 含 XML 标签 | `dlg_markup` | 拒收 |
| 含 JSON 片段 | `dlg_markup` | 拒收 |

### player 检查

- 模型输出 `<player>` → `player_block`，硬错误。
- 出现玩家名下的块（`who="你"` / `who="player"`）→ `player_control`，硬错误。
- 旁白或动作里替玩家做事、写心情 → `player_control`，硬错误。
  只认「你 + 明确动作」且位于句首或标点之后：`从你坐下起`、`搁在你手边`
  这类间接提及不算。误判的代价是整轮被拒收，所以这里宁漏勿错。

## 4. 降级规则

```
act 有问题          → narr（保留原文，只改块类型）
dlg 有舞台指示      → dlg（剥掉括号/星号/叙述前缀）
dlg 剥完为空        → 丢弃该块
```

降级只改块类型和舞台指示，**不删内容、不改字句**。玩家看到的还是模型写的东西，
只是不再假装它是一条「即时动作」或一句「台词」。

降级后的内容会立刻替换屏幕上的原文：屏幕上看到的和存进历史的是同一份。
开发面板会列出「已降级 N 处：act→narr」。

## 5. 防止坏回复进入历史

```
收到模型流
  ↓  replyText 只是 candidate，一个字都没进会话
解析和校验（validateResponseBlocks）
  ↓
accepted  → 原文落地
repaired  → 降级后落地
rejected  → 丢弃，界面恢复到这一轮之前，提示重新生成
```

写入决定本身抽成了一个纯函数（`lib/engine/history.ts`）：

```ts
const outcome = commitTurn(baseTurns, { user, assistant }, result);
// outcome.written === false 时，outcome.turns 就是原样的 base，
// 数组里根本没有这一轮，调用方想污染历史也污染不了
```

拒收时的界面处理：

- 画面恢复到这一轮开始之前（`setTurns(baseTurns)` + `persist(baseTurns)`）；
- 玩家那句话仍然显示在对话里，但下面没有回复，只有一条红色提示：
  「这一轮回复没有通过校验，已丢弃，不会写进历史」+ 拒收原因 + 重新生成 / 取消；
- 这条待重试的记录存在 `rejected` state 里，**不在 `turns` 里**，所以不会被发给模型；
- 点「重新生成」时从 `rejected.baseTurns` 重跑，而不是从当前画面重跑——
  失败的那一版从来没进过历史，重跑时必须把它当成不存在；
- 玩家直接输入新的一句，就等于放弃上一轮被拒收的那条。

## 6. `GenerationResult`

```ts
type GenerationResult =
  | { status: "accepted"; content: string; report: GenerationReport }
  | { status: "repaired"; content: string; report: GenerationReport }
  | { status: "rejected"; reason: string;  report: GenerationReport };
```

`rejected` 分支**没有 `content` 字段**——类型层面就堵死了「拿拒收内容去写历史」。
报告里同时带 `severity`、`decision`、`degradations`，开发面板直接读它。

## 7. 与 Phase 0 的关系

Phase 1 改了三处口径，都会影响和旧基线对比时的读法：

| 项目 | Phase 0 | Phase 1 |
| --- | --- | --- |
| `verdict` | 有任何 block → reject；有 warn → repair | 以质量门结论为准：rejected→reject、degraded→repair、accepted→pass |
| `pseudo_tool_text` | warn | **hard**（工具调用写进正文，按 1.2 归入硬错误） |
| `no_blocks` | warn | **hard**（整段跑出输出契约） |
| 检查项数量 | 16 | 22（新增 who/act 比喻/act 结果/dlg 标签/player 块） |

`verdict` 改口径是必要的：复读、破折号这类只记录的问题不该把一轮判成「可修复」，
否则面板说可修复、内容却原样落地，读的人会以为修复失败了。

## 8. 真机跑批（2026-10-18）

模型 `yosei-router / deepseek-v4-flash-200k`，26 组用例各一轮，
`pnpm baseline --out=doc/phase1-gate-baseline.json`。

| 指标 | 结果 |
| --- | --- |
| 质量门 | 原样落地 23 · 降级落地 3 · **拒收 0** |
| 判定 | 合格 23 · 可修复 3 · 不合格 0 |
| 符合机器预期 | 24 / 26 |
| act | 28 个，其中不合格 4 个（14.3%） |
| 替玩家行动 / 复读 / 语言切错 / 人物漂移 | 0 / 0 / 0 / 0 |

**验收里最关键的一条对上了：原有合法回复完全保持不变。**
23 轮 accepted 的 `content` 就是模型原文（`validate` 直接返回原字符串，不重新序列化）；
3 轮 repaired 的差异只有那一处 act→narr，其余字节不变：

```
原文: <act who="沈砚">他蹲下去，指尖贴着脚印边缘。</act>
落地: <narr>他蹲下去，指尖贴着脚印边缘。</narr>
```

调参过程中真机抓到的两个误判，都补成了回归测试：

- `从你坐下起就没再动过` 被当成「你坐下」→ 把玩家动作限定在句首或标点之后；
- `她倒了半碗热水` 被当成动作结果 → 结果判定收紧到「动作 + 被改变的状态」。

## 9. 验收对照

| Phase 1 验收标准 | 落地位置 |
| --- | --- |
| 不合格回复不会污染下一轮历史 | `commitTurn` 拒收时返回原样的 base（`history.test.ts` 断言数组长度不变、内容不含错误块）；ChatScreen 拒收分支 `setTurns(baseTurns)` + `persist(baseTurns)` |
| 重新生成不会把上一版错误内容继续作为新历史 | `retryRejected` 从 `rejected.baseTurns` 重跑；`history.test.ts` 的「重跑用的是拒收前那段历史」断言新历史里不含第一次的错误内容 |
| 原有合法回复完全保持不变 | `validate` 在 `accepted` 时返回原始字符串；真机 23/26 原样落地，3 轮只改块类型 |
| 所有校验函数都有纯函数测试 | `validate.test.ts` 48 条覆盖块/who/act/dlg/player/三档严重度/降级/落地；`history.test.ts` 6 条覆盖写入决定 |

## 10. 已知取舍

- **误判的代价不对称。** 硬错误会整轮拒收，所以判据都偏保守：
  `从你坐下起` 不判替玩家行动，宁可漏掉一次间接越界。
- **`who` 的「准确」只做归一化比对**（去空白、去括号注解、去称呼后缀），
  不做拼音或编辑距离。差一个字会判 `who_inexact`，这是有意的：
  前端按 `who` 精确匹配头像。
- **降级会丢掉 act 的「动作」语义。** 一段本来想当动作的句子降成 narr 后，
  视觉上是旁白。这是刻意的：宁可读起来像旁白，也不要读起来像三帧动作挤在一行。
- **拒收会丢掉已经生成的内容。** 玩家要重新等一次生成——Phase 2 加了自动修复，
  先让模型只修格式再落地一次；修不好才真的拒收，见
  [phase2-repair.md](phase2-repair.md)。
- **`reject` 之后没有自动重试。** 现在只提示，不自动重发——自动重发可能连续失败，
  反而把玩家卡在那里。
