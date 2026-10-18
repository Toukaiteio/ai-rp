# Phase 0：文本引擎基线

这一阶段不改生成行为，只做一件事：**把「这一轮生成到底发生了什么」变成可复现的数据**。
有了它，后面每次改提示词、改解析、加记忆，都能回答「是真变好了，还是只是感觉变好了」。

- 代码入口：`lib/engine/`（纯函数、可离线测试）
- 开发模式面板：对话页顶栏的 `QA` 按钮
- 用例表：`lib/engine/cases.ts`（26 组，全部合成数据）
- 跑批脚本：`pnpm baseline`
- 基线结果：`doc/phase0-baseline.json`（第一轮）、`doc/phase0-baseline-run2.json`（复跑）

---

## 1. 指标

每轮回复产出一份 `GenerationReport`（`lib/engine/types.ts`）。前九个字段是 Phase 0 指定的指标，
名字固定，用来跨版本对比；其余是同一份观测的扩展。

| 字段 | 含义 | 口径 |
| --- | --- | --- |
| `responseLength` | 可见正文字数 | 剥掉块标记、误写工具标签和空白后的字符数 |
| `blockCount` | 块数 | `parseRawBlocks` 解析出的块总数 |
| `actCount` | act 块数 | 模型**原始输出**里的 act 数量，不含被降级成旁白的 |
| `invalidActCount` | 不合格 act 数 | 命中任意一条 `act_*` 问题的 act 数量 |
| `dialogueCount` | 对白段数 | dlg 块数量 |
| `playerControlViolation` | 是否替玩家说话或行动 | 出现玩家名下的块，或旁白/动作里替玩家做了事、写了心情 |
| `repeatedPhraseCount` | 与上一轮逐字重合的片段数 | 归一化后 8 字以上的重合片段，合并计数 |
| `repairAttempted` | 是否尝试过修复 | Phase 1 才会真的触发；现在由调用方传入，跑批时恒为 false |
| `repairSucceeded` | 修复是否成功 | 同上 |

扩展字段：`turn`、`language`、`sceneCount`、`issues`、`checks`、`verdict`、
`promptVersion`（提示词指纹）、`replyHash`（正文指纹）、`latencyMs`、`providerId`、`model`、`generatedAt`。

两个设计上的取舍值得记下来：

1. **actCount 统计原始输出。** 渲染侧会把不规范的 act 降级成 narr（`lib/blocks.ts` 的
   `pushBlock`），如果检查也按降级后的结果算，「act 不规范」这个指标会被降级逻辑吃掉，永远显示 0。
   所以检查走 `parseRawBlocks`，渲染仍走 `parseBlocks`。
2. **`verdict` 只有三种。** `pass` 合格、`repair` 可修复（只有 warn）、`reject` 不合格（有 block）。
   它就是目标架构里那三个分支，Phase 1 直接照它接。

## 2. 错误类型

22 个问题码，每个都有独立检查函数（`lib/engine/checks.ts`）。判定只用可数的证据，
不做语义理解：宁可标出可疑样本让人工看一眼，也不要一个每跑一次结果都不同的判官。

`block` 与 `warn` 的界线是「这轮内容还能不能进历史」：替玩家行动、语言切错、
凭空造人、讲述者变成角色，这四种一旦写进历史，后面每一轮都建立在错误前提上，所以判 block。

> Phase 1 起，这 22 个码各自多了一条「质量门怎么处理」的约定（降级 / 拒收 / 只记录），
> 判定口径也从「有没有 warn/block」改成以质量门结论为准。
> 见 [phase1-quality-gate.md](phase1-quality-gate.md)。

| 问题码 | 严重度 | 判定方式 |
| --- | --- | --- |
| `act_overlong` | warn | act 超过 `ACT_MAX_LENGTH`（24 字，与解析器共用同一个常量） |
| `act_multi_action` | warn | act 里有逗号/分号分隔的多个分句，或出现「然后/接着/再/继续」这类串联词 |
| `act_has_dialogue` | warn | act 里出现引号，或「说/问/答/低声/语气/声音」这类说话词 |
| `act_has_thought` | warn | act 里出现「心里/觉得/似乎/好像/因为/犹豫/决定」这类心理与解释词 |
| `act_metaphor` | warn | act 里出现明喻（像/仿佛/宛如）、「一般/似的/一样」或拟人（诉说/低语） |
| `act_result` | warn | act 里写了动作造成的结果（把杯子碰倒了、灯灭了） |
| `dlg_has_action` | warn | dlg 里有括号或星号舞台指示，或以「她笑了笑/他叹气」这类转述句式开头 |
| `dlg_markup` | **block** | dlg 里出现 XML 标签或 JSON 片段 |
| `player_control` | **block** | 出现玩家名下的块（`你`/`玩家`/player/自定义称呼），或旁白、动作里替玩家做动作、写心情 |
| `player_block` | **block** | 模型自己输出了 `<player>` 块 |
| `repeated_expression` | warn | 与上一轮回复有 8 字以上逐字重合 |
| `plot_overreach` | warn | 一轮换场 ≥2 次、块数 >12，或长回复里出现「从此/再也/终于/彻底」这类收束词 |
| `language_switch` | **block** | 玩家用中文，dlg 里假名占比 ≥20% 且 ≥4 字 |
| `character_drift` | **block** | dlg/act 的 `who` 不在已知人名里（角色卡 + 本机记忆 + 历史出场过的人） |
| `who_pronoun` | **block** | `who` 写成「她/他/那个人/对方」这类代词 |
| `who_inexact` | **block** | `who` 是角色名的外号、简称或带注解写法，不是准确名字 |
| `narrator_in_character` | **block** | narr/act/scene 里出现第一人称（引号内的不算） |
| `response_overlong` | warn | 可见正文超过 700 字 |
| `summary_tone` | warn | 旁白出现「总而言之/这一切/空气中弥漫着/仿佛在诉说着」这类说明文句式 |
| `style_breach` | warn | 出现破折号 |
| `no_blocks` | warn | 有正文但整段没有任何块标记，或剥掉误写标签后没有内容 |
| `pseudo_tool_text` | warn | 把记忆、掷骰这类函数调用写成了 XML 标签 |

## 3. 检查流水线

```
模型原始输出
  → parseRawBlocks（不做 act 降级，保留模型的真实行为）
  → stripPseudoToolTags（量一下误写标签剥掉了多少字）
  → 逐项检查，产出 issues
  → 汇总 checks（每项检查的 pass / warn / block / skip）
  → 质量门：决定这一轮是原样落地、降级落地还是拒收（Phase 1 起）
```

复读检查在没有上一轮时是 `skip` 而不是 `pass`——没比较对象和比较过是两回事，
面板上要能区分，否则「复读 0」到底是真好还是没查，看不出来。

## 4. 开发模式怎么用

- 开发模式（`NODE_ENV=development`）默认开启；对着预览部署想看的话，URL 加 `?dev=1`；`?dev=0` 强制关闭。
- 顶栏右侧出现 `QA` 按钮，颜色就是最近一轮的判定（灰=合格、黄=可修复、红=不合格带数量）。
- 点开面板，从上到下：
  - 近 N 轮汇总：不合格 / 可修复 / 替玩家 / 复读 / 坏 act 各几轮，以及高频问题排行；
  - 每一轮一张卡：判定、提示词版本、九项指标，然后是**这一轮跑过的每一项检查**及其结果，
    最后列出需要处理的问题。
- 控制台同时打一行 `[ai-rp] generation #n 第 n 轮 …`，方便一边玩一边看。

**隐私边界**（对应验收标准「不记录 API Key、完整隐私聊天内容或敏感数据」）：

- 报告只存长度、计数、问题码和 12 字以内的片段（片段是模型自己刚生成的句子，本来就画在屏幕上）；
- 不存玩家输入，只存它的语言；
- 只在内存里，刷新即失，不写 localStorage、不发请求、不进导出；
- 生产构建不带 `?dev=1` 时全程不计算、不记录。

## 5. 用例表

26 组，全部是合成的角色卡和输入，不含任何真实玩家聊天。每组都有两层预期：

- **机器能判的**：`expect`（判定结果、必须/不得出现的问题码、字数上限、最少对白段数），
  跑批时逐条比对，不符就在结果里列出来；
- **人工判的**：`rubric`（这一轮该不该停在这里、话像不像这个人），需要人读一遍。

| id | 用例 | 想暴露的既有问题 | 玩家输入 | 机器预期 |
| --- | --- | --- | --- | --- |
| `act-01-length` | act 只该是一帧画面 | act 过长：日常场景里模型常把动作写成半段旁白 | 我把湿外套挂在门边的钉子上，坐到你对面。 | 判定 pass；≤400字；不出现 act_overlong、player_control |
| `act-02-multi` | act 不串联两个动作 | act 含多个动作：逗号、然后、说完这类串联 | 我问她这店开了多少年。 | 判定 pass；不出现 act_multi_action、player_control |
| `act-03-dialogue` | act 不混入对白 | act 混入对白：把说话内容塞进动作块 | 我说我不急着住，先坐会儿。 | 判定 pass；不出现 act_has_dialogue、player_control |
| `act-04-thought` | act 不解释心理 | act 混入心理解释：犹豫、因为、似乎这类判断 | 我提起三年前那支木簪。 | 不出现 act_has_thought、player_control |
| `dlg-01-action` | dlg 只放说出口的话 | dlg 混入动作：括号、星号或转述句式混进对白 | 我说我可以先付一半，剩下的明天给。 | 判定 pass；dlg≥1；不出现 dlg_has_action |
| `player-01-silence` | 玩家不说话时不许替他开口 | 替玩家说话：玩家只观察，模型替他接话或表态 | 我什么也没说，就站在门口看着她。 | 判定 pass；≤400字；不出现 player_control |
| `player-02-decision` | 玩家提问时不许替他做决定 | 替玩家行动：把「住不住店」这种选择替玩家做了 | 这里一晚多少钱？ | 判定 pass；不出现 player_control |
| `player-03-action` | 玩家没做的动作不许补 | 替玩家行动：旁白里出现玩家的动作 | 我把伞收起来靠在墙边。 | 判定 pass；不出现 player_control |
| `repeat-01-echo` | 不重复上一轮的表达 | 重复上一轮表达：把上一轮的动作和句子再说一遍 | 我在壁炉边坐下，把手伸过去烤。 | 判定 pass；不出现 repeated_expression |
| `repeat-02-formula` | 不重复上一轮的句式 | 重复上一轮表达：换了内容但句式一模一样 | 我把杯子推回给她，说茶凉了。 | 判定 pass；不出现 repeated_expression |
| `plot-01-rush` | 一轮不推完整段剧情 | 一次性推进太多剧情：一句提议被写成整晚的行程 | 明天我帮你把后院的柴劈了吧。 | 判定 pass；≤400字；不出现 plot_overreach、player_control |
| `plot-02-reveal` | 悬念不许一次性解决 | 一次性解决剧情：问一句就把真相全说了 | 少的那一卷，记的是什么？ | ≤500字；不出现 player_control |
| `plot-03-scene` | 一轮最多换一次场 | 一次性推进太多剧情：一轮里换好几次场 | 我问他，泥脚印通向哪儿。 | 判定 pass；不出现 plot_overreach、player_control |
| `lang-01-kana` | 中文玩家不许被切成日语 | 角色语言切换错误：日文卡让角色整句说日语 | 你午休都在这儿看书？ | 判定 pass；dlg≥1；不出现 language_switch |
| `lang-02-english` | 英文玩家可以走英文 | 语言锁定的反向：玩家改用英文时不该硬塞中文 | Do you always read here at lunch? | 判定 pass；不出现 language_switch |
| `drift-01-warmth` | 冷淡角色不许突然热情 | 角色行为脱离设定：一轮之内性格反转 | 我夸她这店收拾得干净。 | 判定 pass；不出现 character_drift |
| `drift-02-newchar` | 不许发明原设定里没有的人 | 角色行为脱离设定：凭空造出一个 NPC | 后院有人吗？ | 不出现 narrator_in_character |
| `drift-03-firstperson` | 讲述者不许变成角色 | 旁白里出现第一人称，讲述者变成了角色 | 我看着她把灯芯剪短。 | 判定 pass；不出现 narrator_in_character、player_control |
| `long-01-person` | 长对话后人物还在 | 长对话后人物失真：隔了多轮之后性格和口癖是否还在 | 我在楼梯口回头，问她叫什么。 | 判定 pass；不出现 character_drift、player_control |
| `long-02-place` | 长对话后地点还在 | 长对话后地点失真：旅店细节被替换或遗忘 | 我问她，今晚还会有人来吗。 | 判定 pass；不出现 character_drift、player_control |
| `long-03-thread` | 长对话后悬念还在 | 长对话后悬念失真：前面留下的钩子被忘掉或改写 | 那你自己查过吗。 | 判定 pass；不出现 character_drift、player_control |
| `style-01-haruhi` | 毒舌卡要出毒舌的句子 | 角色卡文风：风格包有没有真正改变句子节奏 | 这地图画的是什么？ | 判定 pass；不出现 style_breach、player_control |
| `style-02-dash` | 不用破折号，不堆排比 | 违反文风硬规则：破折号和总结式旁白 | 雨是不是小了点。 | 判定 pass；不出现 style_breach、summary_tone、player_control |
| `edge-01-vague` | 模糊输入不要反问 | 玩家输入模糊时的行为：该继续，不该反问玩家想干嘛 | …… | 判定 pass；不出现 player_control |
| `edge-02-expand` | 玩家要求展开时篇幅可以长 | 边界情况：明确要求展开时，长回复是合规的 | （详细描写一下卷宗库的环境，多写一点。） | 不出现 player_control、narrator_in_character |
| `edge-03-ooc` | 玩家出戏指令不该被当成台词 | 边界情况：括号里的元指令 | （我们换个场景，第二天早上。） | 不出现 player_control、language_switch |

## 6. 跑批

```powershell
$env:YOSEI_API_KEY = "sk-..."
pnpm baseline                                     # 全部 26 组
pnpm baseline --only=act-01-length                # 单组
pnpm baseline --label="改提示词之后" --keep-text=false
```

- Key 只从环境变量读，**不写进任何输出文件**（跑完可以自己 grep 一下 `doc/phase0-baseline.json` 确认）。
- 每组走和游戏里完全一样的两步流程：导演计划（`buildDirectorMessages` → `parseTurnPlan`）
  → 正文生成（`assemble` 组装的完整提示词），温度、max tokens、预算都与线上一致。
- 输出 `doc/phase0-baseline.json`：汇总 + 每组报告 + 每组原始输出。
  文本全部是合成用例，留着是为了人工核对 rubric；不想留就加 `--keep-text=false`。
  换输出文件用 `--out=doc/xxx.json`（基线里的第二轮就是这么跑的）。
- 预期不符不会中断跑批，只会在结果里列出来——基线的价值是观察，不是断言。

## 7. 基线结果（2026-10-18）

模型 `yosei-router / deepseek-v4-flash-200k`，温度 0.9，提示词版本 `aedd6cd6`。
跑了**两轮**，每组各一次，用来顺便估一下方差：`doc/phase0-baseline.json` 是第一轮，
`doc/phase0-baseline-run2.json` 是复跑。

| 指标 | 第一轮 | 第二轮 | 合计 |
| --- | --- | --- | --- |
| 判定 | 合格 22 · 可修复 4 · 不合格 0 | 合格 21 · 可修复 5 · 不合格 0 | 合格 43 · 可修复 9 · 不合格 0 |
| 符合机器预期 | 24 / 26 | 23 / 26 | 47 / 52 |
| act | 29 个，坏 4 个（13.8%） | 33 个，坏 6 个（18.2%） | 62 个，坏 10 个（16.1%） |
| 对白 | 28 段 | 33 段 | 61 段 |
| 平均篇幅 | 109 字 | 112 字 | 110 字 |
| 平均耗时 | 5826 ms | 9605 ms | 7716 ms |
| 替玩家行动 | 0 轮 | 0 轮 | 0 轮 |
| 复读 | 0 轮 | 0 轮 | 0 轮 |
| 语言切换 | 0 轮 | 0 轮 | 0 轮 |
| 人物漂移 | 0 轮 | 0 轮 | 0 轮 |
| 问题分布 | 只有 `act_multi_action`，4 轮 | 只有 `act_multi_action`，5 轮 | 只有 `act_multi_action`，9 轮 |

两轮里不符预期的项都落在同一类：判定是 `repair` 而预期 `pass`，原因都是 act 里出现了逗号串联，
例如「她手腕一顿，抹布停在桌角。」「她头也不抬，铅笔尖在地图中央戳了一下。」。
这不算模型犯规，而是当前 act 规则偏严：**逗号串联很常见，读起来也是自然的**。
Phase 1 要在这里做决定：要么放宽 act 的分句判定，要么把「两个动作中心」和「一个动作带状语」区分开。

### 从基线里能读出来的事

1. **单轮格式已经相当稳。** 52 轮里 0 次替玩家行动、0 次语言切错、0 次凭空造人，
   没有一次整段跑出块协议。Phase 0 想解决的「坏回复污染上下文」，
   在单轮样本里主要不是靠 `reject` 兜底，而是靠 `repair`。
2. **唯一稳定复发的问题是 act。** 62 个 act 里 10 个不合格（16.1%），全部是逗号串联。
   两轮之间 13.8% 到 18.2% 的波动说明样本量还不足以谈小数点，但量级是稳的。
   这是 Phase 1 第一个该动的地方。
3. **篇幅普遍偏短。** 平均 110 字，低于约定的 150 到 300 字；`long-01-person` 两轮都只写了 26 和 33 字。
   短本身不是错（规则也说「只需要一句短回应时不要扩写」），但和「小说化」的目标有张力，
   需要 Phase 2 用场景结构来管，而不是简单加字数下限。
4. **单轮检查抓不到长线漂移。** 26 组里有 3 组带 3 到 4 轮历史，全部通过；
   真正的「长对话后失真」要几十轮才会显形。Phase 0 的检查器只是长线观测的第一层，
   后面还需要一个把模型输出回灌成历史、连续跑 N 轮的浸泡测试（soak），才能量化人物和悬念的衰减。
5. **样本量还不够。** 每组只跑了一轮。要判断「改前改后有没有变好」，同一组至少跑 3 轮取分布，
   或者固定 `seed` 之外的变量（温度、模型版本）再比。
6. **耗时不稳。** 单轮 5.4 秒到 75 秒都有，中继侧排队明显。它不影响质量指标，但会影响体感，
   记录在这里，免得以后把「慢」误判成「改坏了」。

## 8. 已知盲区

- **语义问题抓不到。** 「话像不像这个人」「这一轮该不该停在这里」这类判断，
  检查器一律不管，靠用例表里的 rubric 人工读。Phase 0 只保证可数的部分可复现。
- **`dlg_has_action` 与 `act_has_thought` 是词表匹配**，会有漏报和误报；
  跑批里误报会直接显示在 `mismatches` 里，看到就回来修词表。
- **`character_drift` 只看 `who`。** 角色性格变了但名字没变，检查器看不出来。
- **修复链路还没接。** `repairAttempted` / `repairSucceeded` 目前只由调用方传入，
  跑批里恒为 false，等 Phase 1 把「自动修复一次」接上以后才会有真值。

## 9. 验收对照

| Phase 0 验收标准 | 落地位置 |
| --- | --- |
| 开发模式可以查看一轮生成经过了哪些检查 | `components/chat/DevReportPanel.tsx`，顶栏 `QA` 按钮；每轮列出 16 项检查及结果；控制台同步打一行 |
| 不记录 API Key、完整隐私聊天内容或敏感数据 | 报告只有长度、计数、问题码和 ≤12 字片段；不存玩家输入；只在内存；跑批 Key 只从环境变量读，输出文件不含 Key |
| 至少 20 组人工测试输入 | `lib/engine/cases.ts`，26 组，`cases.test.ts` 断言下限与 id 唯一性 |
| 每组测试输入有预期行为 | 每组带 `expect`（机器可判）+ `rubric`（人工可判）；跑批逐条比对并列出不符项 |
| 记录当前行为以便以后对比 | `doc/phase0-baseline.json` + `promptVersion` 指纹 + `pnpm baseline` 可重跑 |
