# ai-rp

[English](README.md) | 中文

通过沉浸式对话来进行一场冒险、创作一本小说、了解一个人物、体验一个故事。使用 Next.js 开发，可直接部署于 Vercel。

## 部署

环境要求：Node.js 22.19.0（见 `.nvmrc`），pnpm 10.14.0。

### 本地开发

```bash
pnpm install --frozen-lockfile
pnpm dev
```

打开 <http://localhost:3000>。首次使用点右上角齿轮进入「连接设置」，选择提供商、粘贴 Key、选择模型。

### 角色卡翻译

在角色架的「本地」页签，点击卡片下方的「翻译为中文」（英文界面显示 `Translate to English`）。目标语言跟随当前界面，使用当前配置的模型。先翻译角色名，再用固定译名翻译设定、开场白和世界书正文，并同步对白中的角色署名；`{{char}}` 宏保留。译卡加上语言后缀并加密另存，原卡和已有会话不变；作者、头像与其他元数据保留。已经适合目标语言的姓名可以保持不变。

首次确认框提示模型额度与卡片内容发送，并提供主题样式的「以后不再提示」复选框，仅勾选并确认后在本浏览器记住。大卡会分批调用，取消不会退回已发生的模型用量；格式错误或输出不完整时不保存。世界书 OR 关键词保留原词并补充译词，AND 关键词保持原样，避免改变匹配条件。

翻译窗口显示当前字段、已验证段数、已完成原文字符比例及本次累计收到的输出字符；仅在保存成功后显示 100%。分段优先使用段落、句子边界，翻译请求使用低推理强度，不自动重试收费请求。失败会区分输出额度耗尽、内容过滤、流中断、JSON 截断、字段缺失和宏标记损坏等原因。保持窗口打开并点击「继续翻译」，会复用已验证的段；保存失败后的「重试保存」不会重新调用模型。临时译文不落盘，关闭、取消或更改卡片、语言、模型配置会清除。

### 测试与 Docker

安装依赖后，`pnpm test` 是统一离线测试命令，不需要模型 Key 或联网。发布前另跑 `pnpm lint` 和 `pnpm build`；全新构建需要联网下载 Next.js 使用的 Google 字体。

```bash
docker build -t ai-rp .
docker run --rm -p 3000:3000 ai-rp
```

Dockerfile 固定 Node 与 pnpm 版本，用锁文件安装项目依赖、执行测试并构建生产应用，无需额外系统包。首次镜像构建需要联网，启动后访问 <http://localhost:3000>，模型配置仍在浏览器内填写，不写进镜像。

### Vercel

1. 将仓库推送到 GitHub 或 GitLab。
2. 在 <https://vercel.com/new> 导入。Vercel 会识别 Next.js 并按 `pnpm-lock.yaml` 选择 pnpm。
3. `maxDuration` 在 `vercel.json` 中设定：`app/api/chat/route.ts` 与 `app/api/image/route.ts` 均为 300 秒。
4. 无需配置环境变量。`NEXT_PUBLIC_VAULT_SALT` 与 `NEXT_PUBLIC_VAULT_ITERATIONS` 是存档导入的可选默认参数，见 `.env.example`。

```bash
pnpm dlx vercel        # 预览部署
pnpm dlx vercel --prod # 生产部署
```

### 自托管

```bash
pnpm build
pnpm start
```

仅限个人 / 非商业使用。

## 文本引擎观测

角色卡中的常用酒馆文本宏会在显示和发送时展开，原卡保留模板。支持列表、示例及不支持的变量/脚本边界见 [酒馆宏兼容说明](doc/macros-compatibility.md)。

每轮生成都会产出一份结构化报告：块数、act 是否合格、有没有替玩家行动、有没有复读、
语言是否切错，以及判定结果是合格 / 可修复 / 不合格。

- 开发模式点顶栏的 `QA` 按钮查看，每轮列出跑过的全部检查；预览部署可加 `?dev=1` 打开。
- 报告只在内存里，不含正文和玩家输入，不落盘。
- 不合格的回复不会写进历史：先自动降级一次（act 改旁白、对白剥掉动作），
  救不回来时再让模型只修格式修一次，仍然不合格就丢弃并提示重新生成。
- 提示词分两层：稳定层（规则、角色卡、文风、世界书、摘要）负责缓存命中，
  回合层（语言、当前场景、活跃剧情线、回合模式、act 约束与正向示例）
  放在历史之后，让最容易漂移的要求离生成最近。
- 作者注（顶栏大脑图标）只管「这一轮怎么写」：节奏、重点、格式提醒、临时风格。
  它插在最后一条玩家输入之前，可以设出现频率和插入位置，也能按角色卡给默认值。
- 场景状态记「此刻」：在哪儿、什么时候、谁在场、正在发生什么、有哪些线没收。
  每轮只保存变化项，每个字段带可信度——模型猜的内容标成推断，不会悄悄变成设定。
- 未完成的剧情线单独记：每轮最多把和当前场景有关的三条交给模型，
  已交代完的线不会被重新说成悬念，也不会催模型去收线。
- 记忆分五层（场景 / 角色 / 世界 / 剧情 / 风格），不是提到就记：
  要满足「玩家确认、多次出现、影响剧情、来自卡或世界书、工具调用」之一。
  新旧事实冲突时保留旧记录、标记冲突，等玩家确认，不让模型随口改掉长期设定。
- 世界书分三来源（全局 / 角色 / 当前聊天），按「常驻规则 → 当前场景相关 →
  玩家刚提到的关键词 → 普通背景」花预算：预算不够时丢背景，不丢常驻。
- 角色声音把「她怎么说话」拆成句长、直接程度、情绪外露加习惯和口头禅，
  再压成一句话交给模型（不逐项念给它听）。在角色卡的「高级」里填，
  保存时写进 `extensions.voice_profile`，别的客户端读卡不受影响。
- 开发模式顶栏的 QA 面板有两个页签：「检查结果」看这一轮写得怎么样，
  「提示词结构」看模型到底看到了什么（消息顺序、来源、token、
  激活的世界书、场景状态、剧情线、作者注、导演计划）。定位问题先看后者。
- 重新生成会把上一版整个丢掉、保留同一句玩家输入，并附一句临时纠偏
  （说清别复用上一版的什么）。改历史消息之后会提示哪些状态可能过时，
  不自动重算。每条消息都能「分出去」建剧情分支，主干不会被覆盖。
- 有一份 50 组的评测集和三族指标（结构 / 叙事 / 连贯性），
  改完提示词跑一遍就知道有没有变差。连贯性那四项靠 4 轮序列才测得出。
- 改动提示词或解析之后，重跑用例并对比基线：

```bash
$env:YOSEI_API_KEY = "sk-..."   # Key 只从环境变量读，不写进输出文件
pnpm baseline         # 26 组人工用例，看生成质量
pnpm repair-check     # 6 条坏候选，看自动修复行为
pnpm state-check      # 连跑 6 轮，看场景状态和剧情线有没有漂
pnpm lorebook-check   # 三来源世界书的注入与预算分配
pnpm voice-check      # 角色声音 A/B：同一段对话，加不加声音差多少
pnpm regenerate-check # 重新生成：错误回复有没有泄漏、纠偏有没有生效
pnpm test:roleplay    # 50 组评测集的装配检查（不调模型，几秒）
pnpm test:roleplay:live  # 同上但调模型，出三族指标并和基线比（要 Key）
```

细节见 [doc/phase0-baseline.md](doc/phase0-baseline.md)、
[doc/phase1-quality-gate.md](doc/phase1-quality-gate.md)、
[doc/phase2-repair.md](doc/phase2-repair.md)、
[doc/phase3-prompt-layers.md](doc/phase3-prompt-layers.md)、
[doc/phase4-author-note.md](doc/phase4-author-note.md)、
[doc/phase5-scene-state.md](doc/phase5-scene-state.md)、
[doc/phase6-story-threads.md](doc/phase6-story-threads.md)、
[doc/phase7-memory-layers.md](doc/phase7-memory-layers.md)、
[doc/phase8-worldbook.md](doc/phase8-worldbook.md)、
[doc/phase9-voice.md](doc/phase9-voice.md)、
[doc/phase10-prompt-inspector.md](doc/phase10-prompt-inspector.md)、
[doc/phase11-regenerate-edit-branch.md](doc/phase11-regenerate-edit-branch.md)、
[doc/phase12-eval-regression.md](doc/phase12-eval-regression.md)。
