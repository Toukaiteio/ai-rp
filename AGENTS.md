<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ai-rp

## 写码准则

1. 注释最小化：只写代码本身表达不出来的信息，与项目、代码无关的注释一律不留。禁止 TODO / 待办清单式注释、留言式注释，禁止把功能写成注释而不实现。
2. 只改本次需求相关的功能，不顺手重构，不捎带改动无关模块。
3. 不过度兜底，不把 ERROR 降级成静默忽略来「解决」问题。
4. 有成熟包就用成熟包；没有成熟包但有公认最佳实践的，按最佳实践写；两者都没有，按最小实现做。
5. 优先复用已有代码，按模块拆分，严禁超长文件。
6. 需要写死的数据一律数据驱动，放进 `data/` 或配置模块，禁止硬编码进脚本和组件。
7. 未经允许不得修改本文件。

改完至少跑 `pnpm test`、`pnpm lint`、`pnpm build`。动过提示词、解析、记忆、场景、剧情线、世界书、声音之后，再跑 `pnpm test:roleplay`（离线，几秒）和对应的 `*-check` 脚本。跑批与检查结果只写本机 `runs/`（已在 `.gitignore` 里），不进仓库；要判断有没有退化，就和本地上一次的结果比。

## 怎么找代码

- 下面每个大目录给一段介绍与索引，指向入口文件和关键模块。
- 要记更细的内容，就在对应目录下新建 AGENTS.md，并在本节挂上索引；不要把这些细节塞回本文件。
- 别的文档已经写过的，只给文档与章节索引，不重抄一遍。
- 索引一律不写行号，文档会变。

### app/ — 路由与 API 端点

- `app/layout.tsx` 根布局：字体、主题启动脚本、`PwaRegister`。`app/page.tsx` 只渲染 `AppShell`。
- `app/manifest.ts` PWA manifest。`app/globals.css` 全局设计令牌，组件里不写字面色值。
- `app/design/` 仅开发用的 UI 组件总览页，不参与游戏逻辑。
- `app/api/chat/route.ts` 唯一的聊天端点：`POST` 组装并流式生成、`PUT` 摘要压缩、`POST mode=complete` 原样转发（建议输入用）。它只做请求校验、调 `lib/prompt` 组装、调 `lib/providers` 流式、按 `lib/wire` 发 SSE 帧。**不解析消息块、不跑质量门、不做修复、不 `commitTurn`、不落盘。**
- `app/api/cards/route.ts` 在线卡列表代理。`app/api/cards/card/route.ts` 单卡 PNG 下载（主机卡死，防开放代理）。`app/api/cards/avatar/route.ts` 头像中转。
- `app/api/image/route.ts` 生图链路，`action` 分 `score` 与 `generate`。

### components/ — 界面

- `components/chat/` 屏幕级组件：`AppShell`（画面切换与解锁状态）、`ChatScreen`（对话主屏，唯一超长文件）、`ShelfScreen`（角色架）、`SettingsScreen`（提供商 / Key / 生图 / 主题 / 语言）、`CharacterEditor`（卡编辑）、`VaultGate`（未解锁入口）、`AuthorNoteSheet`（作者注 + 只读场景状态）、`PromptInspectorPanel`、`DevReportPanel`（QA 两个页签）、`OnlineCards`、`Announcements`、`Avatar`。
- `components/ui/` 无状态展示组件，统一从 `components/ui/index.ts` 引，颜色只走 `globals.css` 令牌。`Message.tsx` 是消息块渲染层（narr / act / dlg / scene / player），`Composer.tsx` 是输入胶囊。
- `components/pwa/` 注册 Service Worker 与安装按钮。`components/icons.tsx` 图标集。

### lib/ — 纯函数内核

各子目录的公开入口都是自己的 `index.ts`，不要直接引内部文件。

**lib/cards/** 角色卡 V2：解析校验、JSON/PNG 导入导出、在线卡源。`types.ts` 卡与世界书结构 · `validate.ts` 解析 / 序列化 / 落盘转换 · `io.ts` 浏览器侧下载与读卡 · `png.ts` 从 PNG 拆 chara JSON · `online.ts` 在线卡源与头像代理 · `unfiltered.ts` 在线列表开关 · `greetings.ts` 开场白 · `builder-opening.ts` 作者口吻开场白识别与语言适配

**lib/chat/** 会话内三个动作，全是纯函数。`regenerate.ts` 重跑哪一轮与纠偏注记 · `edit.ts` 编辑与过时状态标记 · `branch.ts` 分支树

**lib/engine/** 文本引擎。`types.ts` 问题码与处理表（`GATE_ACTION`） · `checks.ts` 逐项检查 · `validate.ts` 质量门三档与降级 · `report.ts` 检查流水线与 `GenerationReport` · `history.ts` 写进历史的唯一入口 `commitTurn` · `repair.ts` hard 时修一次 · `dev-log.ts` 内存态报告与 Inspector 日志 · `text.ts` 文本计数 · `version.ts` 提示词指纹 · `cases.ts` Phase 0 基线用例

**lib/prompt/** 提示词组装，入口 `index.ts`（`assemble` / `planBudget`）。`system.ts` 核心规则、输出契约、`BLOCK_EXAMPLES`、回合层 · `turn-plan.ts` 导演阶段 · `mode.ts` 回合模式 · `note.ts` 作者注三层来源与插入位 · `worldbook.ts` 世界书排序匹配与预算 · `global-book.ts` 全局世界书槽位（默认空） · `facts.ts` 关键事实 · `summarize.ts` 滚动摘要 · `budget.ts` token 估算与历史裁剪 · `cache.ts` 前缀指纹与缓存观测 · `inspector.ts` 消息来源标签与面板数据 · `language.ts` 语言锚定 · `macros.ts` `{{char}}` / `{{user}}` · `types.ts` 共享类型

**lib/scene/** 场景状态「此刻」。`state.ts` 只记变化的 `applyScenePatch` 与格式化 · `types.ts` 字段与补丁类型

**lib/story/** 未完成剧情线。`threads.ts` `applyThreadPatch` 与 `selectThreads` · `types.ts` 结构

**lib/memory/** 长期记忆，没有 index，入口是 `journal.ts`。`layers.ts` 五层定义 · `rules.ts` 写入理由与冲突保留旧值 · `journal.ts` 目录读写、`applyMemoryWrite`、工具定义

**lib/voice/** 角色声音。`profile.ts` `describeVoice`、开关替换、禁令检查

**lib/providers/** 模型适配，只有 Chat Completions 一条路，入口 `index.ts`（`getProvider`）。`openai.ts` 官方 SDK 流式 · `config.ts` 读 `data/providers.json` 预设 · `settings.ts` 用户配置默认值与可用性 · `apikey.ts` Key 清洗 · `errors.ts` 错误归一化与脱敏 · `validate.ts` baseURL 解析与内网拦截 · `images.ts` 生图

**lib/storage/** 本地存储，入口 `index.ts`（`getSessionStore`）。`types.ts` 会话结构与工厂 · `local.ts` 会话与卡记忆读写 · `backend.ts` 加密后端回退链 · `cards.ts` 导入卡表 · `settings.ts` 提供商配置读写 · `archive.ts` 整包导入导出

**lib/vault/** 加密保险库，入口 `index.ts`。`crypto.ts` PBKDF2 原语 · `registry.ts` 数据模块注册表 · `remember.ts` 自动解锁记忆 · `config.ts` 部署侧 KDF 参数

**lib/eval/** 离线评测与回归，入口 `index.ts`。`cases.ts` 50 组 / 15 类用例 · `sequences.ts` 连贯性序列 · `metrics.ts` 三族指标与退化判定

**lib/image/** 生图，入口 `index.ts`。`style.ts` 画风 · `brief.ts` 外貌抽取、场景去重、提示词与评分消息 · `policy.ts` 自动出图节流

**lib/export/** 导出 EPUB，入口 `index.ts`。`chapters.ts` 切章 · `render.ts` 章节 HTML · `image.ts` 图片压缩与封面 · `epub.ts` 组装

**lib/i18n/** 界面文案中英切换，不含聊天内容与提示词。`zh.ts` 是键名底稿，`en.ts` 逐项对齐。

**lib/ 根目录散文件** `blocks.ts` 消息块解析（渲染用 `parseBlocks`，检查用 `parseRawBlocks`） · `wire.ts` SSE 帧格式 · `dice.ts` 掷骰 · `suggest.ts` 建议输入 · `chat-image.ts` / `chat-document.ts` 附件处理 · `browser-model.ts` / `browser-openai.ts` 浏览器直连 · `announcements.ts` 公告 · `theme.ts` + `use-theme.ts` 主题 · `last-card.ts` + `startup-card.ts` 启动进哪张卡 · `seed.ts` 确定性种子

### scripts/ — 跑批与检查

全部经 `scripts/alias-loader.mjs` 运行（把 `@/` 映射到仓库根）。真机脚本统一读 `YOSEI_API_KEY ?? BASELINE_API_KEY`，可用 `BASELINE_MODEL` / `BASELINE_BASE_URL` 覆盖。

`baseline.ts` Phase 0 基线跑批 · `repair-check.ts` 修复行为 · `state-check.ts` 场景状态 · `lorebook-check.ts` 世界书 · `voice-check.ts` 声音 A/B · `regenerate-check.ts` 重新生成 · `eval.ts` 评测（`--live` 走真机并比对基线） · `verify-cards.ts` 卡链路自检（没有 npm script，直接 node 跑，不调模型）

### data/ — 数据驱动的内容

`providers.json` 提供商预设（`lib/providers/config.ts` 读） · `announcements.json` 公告（`lib/announcements.ts` 读）。加这类内容改 JSON，不改代码。

### 根配置

`next.config.ts` Next 配置（turbopack 别名、cacheComponents） · `vercel.json` 部署与 `maxDuration` · `vitest.config.ts` 测试范围与 `@` 别名 · `tsconfig.json` 路径别名 `@/*` · `.env.example` 保险库 KDF 公开参数 · `README_CN.md` 部署与「文本引擎观测」总览
