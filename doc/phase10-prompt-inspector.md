# Phase 10：Prompt Inspector

定位异常输出的第一步不是改提示词，是**确认模型到底看到了什么**。
Phase 10 把「最终发出去的那份提示词」做成可查的结构，而不是靠
「把 messages 打出来数第几条是什么」。

- 数据结构与组装：`lib/prompt/inspector.ts`
- 组装器产出的标签：`lib/prompt/index.ts` 的 `push`
- 面板：`components/chat/PromptInspectorPanel.tsx`（挂在 QA 面板的第二个页签）
- 内存缓冲：`lib/engine/dev-log.ts` 的 `recordInspector`
- 测试：`lib/prompt/inspector.test.ts`（28 条）+ `components/chat/PromptInspectorPanel.test.tsx`（13 条）
- 参考：[SillyTavern Prompts](https://docs.sillytavern.app/usage/prompts/)

---

## 显示什么

面板按你列的结构分组，每组带条数和 token：

```
[System] 2 条 · 1350 token
  #0 system · core_rules · 435t
  #1 system · output_contract · 915t
[Character Card] 1 条 · 21 token
  #2 system · name / description / personality · 21t
[Character Voice] 1 条 · 42 token
  #3 system · describeVoice 压缩后的一句话 · 42t
[Scene State] 2 条 · 372 token
  #3 system · card.scenario · 13t
  #6 system · 场景 + 剧情线 1 条 + 模式 dialogue · 359t
[Author's Note] 1 条 · 43 token
  #4 system · depth 1 · 43t
[User Input] 1 条 · 12 token
  #5 user · 玩家输入 · 12t
[World Book] 4 条 · 254 token
  #7 system · worldbook.after_char（常驻） · 10t
  #10 system · worldbook（关键词命中） · 10t
  #12 system · 记忆目录 / 工具结果 · 223t
[Post-History Rules] 1 条 · 10 token
[Director Plan] 1 条 · 16 token
合计 15 条 · 2187 token（前缀 1455 / 历史 75 / 回合 657）
```

每条能展开看正文，右侧标着 role、层级（前缀/历史/回合层）、token，
打了缓存断点的那条有 `cache` 标记。

顶部还有一段**激活的世界书**：

```
激活的世界书条目 3 条
[chat/constant] 这一场是深秋。
[global/constant] 这个世界没有魔法。
[card/player] 命中 书 · 她手里是《夏目漱石的心》。
```

校验结果、是否触发自动修复仍在第一个页签（Phase 1/2 就有的那份报告）。

## 关键实现：标签是组装的副产品

Inspector 的价值全在「它显示的确实是发出去的东西」。所以来源标签**不是**
事后按内容猜的，而是组装时顺手记下来的：

```ts
const push = (bucket: ChatMessage[], origin: MessageOrigin, message: ChatMessage) => {
  bucket.push(message);
  (bucket === prefix ? prefixOrigins : postOrigins).push(origin);
};
```

每条 `push` 都写明它属于哪个区段、哪一层、具体是谁。这样加一段新内容时
必须同时说明它从哪来——忘了写会立刻在面板里显示成「未标注」，
比事后补文档可靠。

**下标要等最后才能算。** 历史夹在前缀和回合层中间，而历史长度要等
裁剪和插入作者注之后才知道。所以三层各攒各的标签，拼 `messages` 时统一编号。

## 两个刻意的设计

**1. 作者注和导演计划的排序。**

第一版按区段枚举顺序排，结果面板上 `[Director Plan]` 出现在
`[Author's Note]` 前面——因为导演计划在枚举里靠后，但它的消息下标最大。
读起来像是计划先于注记，和实际发出去的消息顺序不符。

改成按**各段第一次出现的位置**排。现在注记（在历史里，靠前）一定排在
导演计划（最后）前面。

**2. 导演计划要单独补一条。**

它由模型现场生成，组装时还不存在，所以是 `assemble()` 返回之后才拼上去的。
`withExtraMessage` 负责把它补进面板——不补的话，Inspector 显示的就不是
最终发出去的那份，而「少了一条」正是最难发现的错。

## 和 Phase 0 约束的关系

Phase 0 定的是「报告里不记录完整正文」。Inspector 必须带正文，两者冲突，
所以**分开存**：

| | 存什么 | 上限 | 用途 |
| --- | --- | --- | --- |
| `reportLog` | 长度、计数、问题码、12 字片段 | 20 轮 | 这一轮写得怎么样 |
| `inspectorLog` | 每条消息的完整正文 | 3 轮 | 模型看到了什么 |

两份都在内存里，刷新即失，不落盘、不进导出、不发请求。
`clearReportLog` 两份一起清。

面板里也是两个页签，不堆在一起：先看哪个是明确的。
报告页签回答「输出有没有问题」，Inspector 页签回答「是不是喂错了东西」——
后者常常更快定位到根因。

## 验收对照

| Phase 10 要求 | 落地位置 |
| --- | --- |
| 最终发送的消息顺序 | `inspector.messages` 的下标就是 `messages` 的下标，测试逐条比对 |
| 每条消息的 role | 每行右侧 |
| 每条消息的来源 | `detail`（`core_rules` / `worldbook.after_char（常驻）` / `depth 1` …） |
| token 估算 | 每行 `tokens`，和预算环共用 `estimateTokens`，测试断言两者一致 |
| 哪些世界书被激活 | 顶部单独一段，带来源、优先级、命中的触发词 |
| 当前场景状态 | `[Scene State]` 段，`detail` 写明含几条剧情线和什么模式 |
| 当前剧情线 | 同上（在回合层那一条的 `detail` 里） |
| Author's Note | `[Author's Note]` 段，标出 depth |
| 导演计划 | `[Director Plan]` 段，`withExtraMessage` 补进去 |
| 最终输出 | 第一个页签的检查报告里（`responseLength` 等） |
| 校验结果 | 同上 |
| 是否触发自动修复 | 同上（`repairAttempted` / `repairSucceeded`） |

## 已知取舍

- **只留最近 3 轮。** 它带着完整正文，留多了就是内存里堆一份聊天记录。
  要对比更早的轮次，用第一个页签的报告（那份留 20 轮）。
- **token 是估算，不是真分词。** 和预算环用的是同一个函数，
  所以面板里的数字和预算对得上，但和上游账单不会完全一致。
- **历史只标到「玩家输入 / 角色回复」。** 没有逐轮编号，也没有标出哪几轮
  被裁剪丢掉了。裁剪信息在 `budget.dropped` 里，面板暂时没展示。
- **不显示发给上游的 tools 定义。** 记忆和掷骰的工具描述是另一条通道，
  目前不在 Inspector 里。要看它得直接看 `MEMORY_TOOLS`。
- **服务端路径下导演计划不补。** 回退到 `/api/chat` 时计划在服务端拼，
  前端拿不到全文，所以那一轮的面板只到组装结果为止（少了 Director Plan 一段）。
