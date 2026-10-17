<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ai-rp

极简的 Serverless AI 角色扮演游戏。AI 任讲述者，不扮演角色。以下约束为全局约束，所有阶段都必须遵守。

## 项目定位

- 核心是 **AI 作为故事讲述者**：用讲述者的口吻转述世界里发生的一切，包括角色的动作和话。讲述者不成为任何一个角色，第一人称只属于玩家。
- 和 story-generator 的区别：story-generator 是 Vue 3 + Electron 的桌面端创作工具，做大纲、角色、章节、Vibe AI 改稿，剧情在开发时批量写好。本项目是**运行时的网页游玩端**：玩家实时输入，AI 实时讲述。
- 对标酒馆（SillyTavern）：借鉴它的角色卡和提示词组装思路，不抄它的臃肿实现。**不做**酒馆那种琳琅满目的设置面板。

## 技术栈

- 前端 + 后端：Next.js（App Router）+ TypeScript，部署在 Vercel。**不要用 Nuxt.js。**
- 第一版只做 OpenAI Chat Completions 接口。**不要做 Text Completion 模式。**
- 优先使用官方 SDK 做接口适配。**不要自己手写 fetch 去拼流式格式。**
- 流式：用 fetch + ReadableStream / SDK 流式，SSE 打字机输出。**不要用 WebSocket**，Vercel Serverless 没有长连接。
- 函数用 Node.js Runtime（Fluid Compute），**不要用 Edge Runtime**。`maxDuration = 300`。
- Vercel 免费版 Hobby 只用于个人 / 非商业内测。游戏本身不收款、不做账。一旦以后要收费，必须先升级到 Pro，不要在 Hobby 上做商业用途。

## 提供商与计费

- Token 模式：**BYOK 为主**。玩家用自己的 Key。
- 自己只作为一个预设提供商，不直接把计费整合进游戏。游戏里只放一段预设配置：`id` / `name` / `baseURL` / `models` / `keyUrl` / `docUrl`。用户点「获取 Key」跳去中继站注册充值，复制 Key 回来粘贴。
- 预设里除了自己的 Yosei-Router，还要再放 1 到 2 个主流预设（如 OpenAI、DeepSeek），再加一个「自定义 BaseURL」。**游戏是通用 BYOK 客户端，不是单一收费引流页。**
- **不要**在游戏里写余额、扣费、支付逻辑。计费、防刷、用量统计都在中继那边。
- 中继不留存数据。游戏也不在服务端存聊天内容和 Key。
- 内测范围：只做小范围内部测试，不公开发布。不做公开营销，不做 R18 内容推广。

## 内容政策

- 不主动做 R18 内容，也不限制。产品本身保持**中立工具定位**。
- 系统提示里不要写鼓励 R18 的话，也不要写硬拦截。让测试者自己的卡和输入决定走向。
- 有审核模型渠道可用，但**不要**把该渠道写进公开配置、公开仓库、公开分支。只放在内测部署的环境变量里。

## 讲述者核心规则（写入 System Prompt）

- 模型是故事的讲述者，不是任何一个角色，也不要变成任何一个角色。角色的动作、心思和话全部由它转述，世界里的 NPC 也一样。
- 不要用角色的第一人称说话。第一人称只属于玩家：模型写「我」就等于占了玩家的人物。角色的内心活动只能作为讲述者的观察写出来。
- 不要替玩家说话，不要替玩家做决定，也不要代写玩家的反应和心情。
- 保持人设一致，不要突然换性格，不要发明原设定里没有的人物、地点、事件。
- 每次回复控制在 150 到 300 字，除非玩家要求展开。
- 用口语化、具体的描写，不要用总结式、说明文式的句子。
- 不要出现「作为 AI」「作为语言模型」这类表述。
- 不要使用破折号，不要堆砌排比句和成语。
- 如果玩家输入模糊，先按最合理的理解继续，不要反问玩家该怎么做。

### 消息块（讲述者口吻的分工）

- `<narr>` 写世界：环境、氛围、时间流逝、非当前角色的反应。
- `<act who="角色名">` 转述某个角色的动作、表情、姿态；心理活动写成讲述者的观察。
- `<dlg who="角色名">` 只放角色说出口的原话。
- `<scene>` 交代场景切换、时间流逝或状态变化。
- 谁在动作、谁在说话由 `who` 决定，讲述者本人不登场。`player` 块只标记玩家输入，模型永远不输出它。

### 工具边界

- 记忆（remember_character / remember_place / remember_event / forget_memory / read_memory / search_memory / list_memory）和掷骰（roll_dice）只能走函数调用。
- 模型不得在回复里用标签、函数名、参数或 JSON 写它们，也不得在正文里交代自己记了什么。没有可用工具时就别记，继续讲。

### 文风（二选一，拼在 System 后面）

- **凉宫春日式**：讲述者口吻，语气毒舌、节奏快，多写即时反应和心理吐槽，少写大段环境说明。吐槽是讲述者的点评，不是角色在自言自语。
- **无职转生式**：讲述者口吻，偏内省和反思，只在转折点和气氛变化时用一两句点破角色没说出口的东西，不要每句都反思。

## 酒馆（SillyTavern）借鉴与砍掉清单

**抄（借鉴）**

- 角色卡 JSON（V2 字段名）
- Token 预算式提示词组装（服务端、纯函数、可测试）
- 简化版世界书
- Author's Note
- 提示词顺序即数据
- 单 JSON 采样预设
- Swipes / 重新生成
- `{{char}}` / `{{user}}` 宏
- 追加式 JSONL / JSON 聊天模型

**砍（不做）**

- 25 个聊天 + 15 个文本提供商矩阵
- Text Completion 模式
- 扩展 / 插件系统
- 完整 Prompt Manager UI
- 多用户账号
- BYOK 密钥管理器
- 扁平文件 data 树
- TTS / 图像生成 / RAG（第一版只保留图像生成的接口预留）
- 群聊多策略矩阵
- jQuery SPA
