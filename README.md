# ai-rp

极简的 Serverless AI 角色扮演游戏。AI 是故事的讲述者，转述角色与世界，不扮演具体角色。部署目标是 Vercel。

当前进度：聊天链路已接真实提供商（OpenAI Chat Completions 协议，BYOK）。服务端组装器、三层记忆、世界书、增量摘要、本机加密、场景 CG、EPUB 导出都已完成。生成 CG 的自动评分默认关闭。没有 EPUB 导入。

角色卡不预制在代码里：角色架里有一个默认收起的「在线角色卡」列表，展开时去卡源拉一页热门（服务端与本机各缓存 5 小时），点「加入」把卡下载到本机。界面明写这些内容来自网络、本项目不审核也不负责。公告写在 `data/announcements.json`，关掉后按 id 记在本机。

## 环境要求

- Node.js >= 20.9
- pnpm（`packageManager` 已锁到 pnpm@10.14.0，仓库里没有 npm 的 lockfile）

## 本地跑

```bash
pnpm install
pnpm dev
```

打开 http://localhost:3000 。首次使用点右上角齿轮进「连接设置」，选提供商、填 Key、选模型。组件总览页在 http://localhost:3000/design 。

## 安装为应用（PWA）

生产部署使用 HTTPS 后，支持 PWA 的浏览器会根据页面地址栏或浏览器菜单提供「安装 ai-rp」/「添加到主屏幕」。安装后会以独立窗口打开，聊天数据仍只保存在本机浏览器的加密存储中。

本地开发时 `http://localhost:3000` 也可用于测试安装；首次打开后刷新一次，让 service worker 接管页面。PWA 只缓存网页壳和图标，不缓存 `/api/` 请求、API Key 或聊天内容。

```bash
pnpm build && pnpm start   # 生产模式
pnpm lint
pnpm test                              # 组装器、世界书、摘要、50 轮回归、加密、回退
pnpm dlx tsx scripts/verify-cards.ts   # 角色卡与消息块协议
```

## 目录结构

```
app/
  page.tsx              首页（渲染 AppShell）
  layout.tsx            根布局
  globals.css           设计令牌：颜色、圆角、阴影、字体只在这里定义
  api/chat/route.ts     POST /api/chat，SSE 流式转发
  api/cards/route.ts    GET /api/cards，在线角色卡列表（5 小时缓存）
  api/cards/card/route.ts  GET /api/cards/card，下载一张卡并拆出 JSON
  design/               UI 组件总览页
components/
  ui/                   从原型提取的 UI 组件
  chat/AppShell.tsx     画面切换、当前角色、连接配置
  chat/ChatScreen.tsx   发原始上下文、解析 SSE、按块渲染
  chat/ShelfScreen.tsx  角色架：选角、导入、在线卡
  chat/OnlineCards.tsx  在线角色卡区块（默认收起）
  chat/Announcements.tsx  公告条
  chat/SettingsScreen.tsx  连接设置
  chat/Avatar.tsx       占位头像
  icons.tsx             图标
lib/
  cards/                角色卡系统
    types.ts            V2 字段类型
    validate.ts         宽松解析外来 JSON、补齐字段、序列化
    png.ts              从 PNG 的 tEXt 块里拆出卡 JSON
    online.ts           在线卡源归一化、地址构造
    io.ts               导出下载、读取导入文件
    index.ts
  announcements.ts      公告内容与「已关闭」记录
  blocks.ts             块解析、还原纯文本、还原标记文本
  suggest.ts            建议输入的提示词与解析
  vault/                本机加密
    crypto.ts           PBKDF2 + AES-GCM 原语
    index.ts            状态机、加密槽位、存档
    registry.ts         数据模块的登记，避免与存储层循环依赖
  storage/              只在浏览器本地，不落服务端
    backend.ts          IndexedDB 优先，回退 localStorage
    local.ts            会话与每张卡的长期记忆
    cards.ts            导入的角色卡
    settings.ts         连接设置（含 API Key）
    archive.ts          加密存档的导出与导入
    types.ts
  prompt/               提示词组装，纯函数，在服务端跑
    index.ts            assemble()：顺序固定，字节级稳定
    system.ts           讲述者定位与核心规则、四类块协议、两种文风
    worldbook.ts        世界书匹配
    summarize.ts        增量摘要
    facts.ts            结构化关键事实
    budget.ts           token 粗估与超预算裁剪
    cache.ts            前缀指纹与命中率
    macros.ts           {{char}} / {{user}} 宏
    types.ts
  providers/            提供商适配
    index.ts            getProvider()：上层唯一入口
    openai.ts           Chat Completions 适配器（官方 SDK）
    errors.ts           错误收敛与消毒，保证不泄露 Key
    validate.ts         Base URL 解析与内网地址拦截
    config.ts           providers.json 读取
    settings.ts         ProviderConfig 类型与默认值
    types.ts            ProviderAdapter 接口
  export/               浏览器里生成 EPUB，没有导入
    chapters.ts         按场景、标记、30 轮分章
    render.ts           旁白与对白分开排，OOC 开关
    image.ts            嵌书前压缩图片
    epub.ts             调用 jepub 打包
  wire.ts               SSE 帧编解码
data/
  announcements.json    公告内容
  providers.json        预设提供商配置
scripts/
  verify-cards.ts       角色卡与消息块协议的验证脚本
```

在线卡源在 `lib/cards/online.ts` 里换：实现一个归一化函数加两个地址构造函数就行，界面和路由不用动。下载地址只认白名单主机，`path` 形状不合规直接回 400，不接受调用方传任意 URL。


## /api/chat

`POST`。Key 走请求头，**不接受 query 参数**（否则会落进访问日志和 Referer）：

```
Authorization: Bearer <key>
```

请求体：

```jsonc
{
  "providerId": "yosei-router",
  "model": "gpt-5-mini",
  "temperature": 0.9,
  "maxTokens": 1024,
  "baseURL": "https://...",   // 可选，只在自定义提供商时需要
  "sessionId": "…",            // 只用来按会话统计缓存命中率，不落库
  "context": {
    "card": { "name": "林晚晴", "description": "…", "personality": "…", "scenario": "…" },
    "lorebook": { "entries": [] },
    "history": [{ "role": "user", "content": "老板娘，来杯热姜茶。" }],
    "seed": 1,
    "summary": { "text": "", "coveredIndex": 0, "compressedCount": 0 },
    "facts": { "characters": {}, "places": {}, "flags": {} }
  }
}
```

组装在服务端做。顺序固定：核心规则、角色卡、世界书（按位置）、风格、关键事实、滚动摘要、最近历史。预算是 `maxContext - 1024 - 3`，不够时先丢历史中间，不丢规则和角色卡。前缀字节级稳定，响应头 `X-Cache-Key` 是它的指纹；命中率只在服务端计数，不下发到界面。

`mode: "complete"` 时不组装，把 `messages` 原样转给上游。建议输入走这条，不进缓存统计。

`PUT /api/chat` 做增量摘要：模型只总结新增部分，服务端接到旧摘要后面，并合并 `<facts>` 里的结构化事实。不整段重写。

成功时返回 `text/event-stream`。第一帧是 `meta`（占用、丢了几条、要不要压缩），后面才是正文：

```jsonc
data: {"type":"meta","used":1200,"max":14973,"dropped":0,"kept":4,"lorebookEntries":1,"needsSummarize":false,"cacheHit":false,"provider":"…","model":"…"}
data: {"type":"delta","text":"<narr>雨还在下。"}
data: {"type":"done","finishReason":"stop"}
data: [DONE]
```

失败时返回**真实的 HTTP 状态码**和一个 JSON 体（不是塞进 200 的流里）：

```jsonc
{ "error": { "status": 401, "code": "invalid_api_key", "message": "Key 无效或已过期，请重新获取" }, "provider": "Chat Completions · api.openai.com" }
```

连接期失败（401 / 404 / 429 / 超时 / 连不上）都走这条路径。流已经开始之后的错误才用 SSE 的 `error` 帧。

### 远程模型的连接顺序

远程 BYOK 聊天默认优先由浏览器直接请求提供商的 OpenAI-compatible `/chat/completions`，正常响应不再绕行 Vercel。浏览器直连需要提供商允许带 `Authorization` 的 CORS 预检，并且只接受 `https` 地址；不支持 CORS、地址无效、权限失败或直连流无法解析时，本机会自动回退到 `/api/chat` 服务端转发。服务端转发仍保留，因为不是每个中转站都适合浏览器直连。

直连时 API Key、完整提示词和图片会从浏览器发送到所选的 Base URL。自定义提供商请只填写可信的 HTTPS 地址；浏览器直连不能替代提供商本身的隐私和密钥安全承诺。建议输入和长剧情摘要仍使用 `/api/chat` 的服务端路径。

## 场景 CG

连接设置里的「生图」没填模型时，回复下的「生成 CG」和输入框「＋」菜单里的同一行都是灰的，旁边写着「未配置生图模型」。填了模型才可点。

点下去之后：用当前场景、角色外貌和固定画风（默认现代日系平涂）让对话模型写一段英文提示词，再调 Images 接口。图挂在这条回复下面，可以重新生成，也可以保存到本机。图会跟会话一起加密存在本机，不进下一轮的文字提示词。

自动生成默认关。打开之后才打分：场景切换、新地点、新角色、情绪高潮才值得。最多每 10 轮 1 张，每场不超过设置里的上限（默认 3），相似场景不重复。打分和出图都在回复落地之后另起请求，不挡住聊天。

## 消息块协议

模型每轮只输出带标记的块，前端按标记渲染。不带标记的文本一律按角色对白处理，保证旧回复也能显示。

| 块 | 渲染 | 谁产出 |
| --- | --- | --- |
| `<narr>…</narr>` | 旁白。无头像、无名牌、无消息背景，暗一档（`--ink-2`）、小半号（15px）、行距收紧，左缘一条 1px 细线；细线画在留白里，正文起始位置与对白严格对齐 | 模型 |
| `<dlg who="角色名">…</dlg>` | 角色对白。圆形头像 + 姓名，正文最亮（`--ink`，16.5px） | 模型 |
| `<scene>…</scene>` | 场景事件。居中中性胶囊，无说话人 | 模型 |
| `<player>…</player>` | 玩家。右侧亮色气泡 | 前端。玩家每轮输入由前端包上标记写进存储，模型被明确要求不要输出它 |

同一轮里的块间距是 10px，轮与轮之间 26px。旁白和对白挨得一样远会读成三张互不相干的卡片，所以一轮之内的块收紧，轮次之间保持原来的呼吸感。

三处实现细节：

- **流式未闭合**：最后一个块常常还没闭合，`parseBlocks()` 会把未闭合的开标签也按对应块渲染，否则打字机打到一半会把旁白显示成对白。
- **还原纯文本**：`blocksToPlainText()` 抹掉标记只留可读内容（对白加「」，场景加〔〕），供阅读、搜索、token 粗算使用。玩家那几轮在进提示词前会先经过它，因为 role 已经说明是谁说的了。
- **保留旁白语义**：`blocksToRaw()` 保留标记文本，回灌模型（让它看见自己的输出格式）和 EPUB 导出都用它。导出要区分旁白与对白，走 `parseBlocks()` 拿块再按 `kind` 渲染即可，语义不会丢。

## 角色卡

兼容 SillyTavern Character Card V2 字段名：`name` / `description` / `personality` / `scenario` / `first_mes` / `mes_example` / `system_prompt` / `post_history_instructions` / `alternate_greetings` / `character_book` / `tags` / `creator` / `character_version` / `extensions`。

**本地只收 JSON，但在线卡是 PNG。** 酒馆系的卡是「一张 PNG，`tEXt` 块里塞 base64 的 `chara` JSON」，`lib/cards/png.ts` 负责把它拆出来，之后走和本地 JSON 导入完全相同的解析链路。

- 代码里不放任何别人的卡。角色架底部有一个默认收起的「在线角色卡」，展开才去卡源拉一页热门，服务端与本机各缓存 5 小时；点「加入」下载到本机，之后怎么用都与卡源无关。界面明写内容来自网络、本项目不审核不托管不负责。
- 角色架里可以导入 / 导出 JSON（导出的是角色卡本身，明文，方便分享）。整机备份走「连接设置 → 导出存档」，那个是加密的。
- 导入接受完整的 V2 外壳，也接受只有字段的裸对象，只有 `name` 是硬要求。不认识的字段会原样存进 `extensions._unmapped`，导出时不丢。
- 导出会把 14 个声明字段补齐（空的写成 `""` / `[]` / `{}`），字段形状稳定，来回一次不少东西。空世界书例外，那是刻意省略的。
- 导入的卡存在浏览器里，加密，删除也只删本地。

**世界书**最小是 `keys` / `content` / `constant`。`constant: true` 每轮都注入；其余默认命中任意一个关键词（`logic: "and"` 才要求全中）。可选 `order`、`position`、`probability`、`scanDepth`、`cascade`，书一级还有 `recursiveScan`、`budgetCap`、`tokenCap`。**只有 `content` 进提示词，`keys` 本身永远不进。**

**开场白**用 `first_mes`。`alternate_greetings` 在开场白下面的「换一条开场」里轮换，不是装饰数据。

**建议输入是现场生成的**，不写死在卡里。每次回复落地后（以及进页面时）发一个次要请求，让模型看着最近六轮对话生成 3 条玩家接下来可能输入的话。这个请求失败不影响对话，也不弹错误。角色各有各的语境，固定一套换个人就对不上。

## 公告与 AI 生成提示

公告内容在 `data/announcements.json`，静态 import，改公告就是改那个文件。字段是 `id` / `title` / `body` / `level` / `date`，坏条目在解析时跳过，不会让页面挂掉。

界面上公告不是横幅，是一颗铃铛按钮：解锁门在右上角，角色架在页头，对话页在右下角「更多」抽屉里，有新公告时角上有个点。点开是一个居中的对话框，里面列全部公告，未读的那几条带一个「不再提示」。关掉后按 id 记在本机 localStorage，别处也不再出现。

对话页输入框下方常驻一行「对话内容由 AI 生成，请自行负责、自行甄别」，关不掉也不随公告消失。

**没有内容审查**：没有相应资源支持，服务端也不读聊天内容。政策只以公告的形式告知，不设拦截。在线角色卡的标签由卡源给出，我们只原样展示，不额外打分级；卡自带的那几个分级词不回显，卡照常列出、照常能玩。

## 本机存储与加密

所有落在本机的东西都是密文，密钥由用户设定，**不存在任何地方**——不进 localStorage、不进 IndexedDB、不进 Cookie、不打日志。

算法是 PBKDF2（600,000 次迭代，SHA-256）派生 AES-256-GCM 密钥，派生结果 `extractable: false`，且只活在内存里。每次加密换新 IV，同样明文两次加密得到不同密文。盐和校验值可以存：盐是随机字节，校验值是用派生密钥加密的一段固定明文，都拿不到密钥的可逆形式。

分层：

| 数据 | 放哪 | 说明 |
| --- | --- | --- |
| 连接设置（含 API Key、Base URL、模型） | localStorage | 小但敏感，固定在这一层 |
| 聊天记录、角色卡、摘要、关键事实 | IndexedDB，不支持则回退 localStorage | 大块数据，回退对上层透明 |

四个动作：设定密钥、锁定、解锁、清除本机数据。未解锁时聊天和设置**整个不挂载**，只显示解锁入口，所以明文 Key 和聊天内容在解锁前根本不在页面上。

连续输错 5 次密钥会清掉本机全部数据（含 IndexedDB 里的密文）并回到未设定状态。错误计数本身只是一个数字，随密钥无关，不泄露密钥信息；失败文案也不区分「密钥错」和「密文坏了」。

导出 / 导入的存档同样是加密的，用同一个密钥。导入会校验：密钥不对、文件不是本项目的存档、内容被改过，都会明确报错，绝不静默成功——静默失败会让人以为导进来了，然后发现数据没了。

忘了密钥没有任何找回方式。这一点在设定密钥的界面上说清楚了。

## Key 怎么处理

- 只从 `Authorization` 请求头读，不接受 query 参数。
- 加密存在本机（localStorage 槽位），密钥由用户设定、不落盘。未解锁时整份配置读不出来。
- 服务端只活在那一个请求的内存里。不写数据库、不打日志。
- 错误返回前一律过 `lib/providers/errors.ts` 的 `toChatError()`：已知状态码只用固定中文文案，不转发上游原文（上游 401 的 message 常把 Key 前后缀拼在里面）；所有出口再走一遍 `redact()` 兜底；`error.headers` 永不外传。

## 中断

浏览器点停止 → `fetch` abort → 路由的 `request.signal` → 内部 `AbortController` → SDK 的 `signal` → 上游 HTTP 连接被掐断。ReadableStream 的 `cancel()` 也接同一个 controller，两条路径都会断掉上游，不让它继续烧 token。

## 提供商配置

`data/providers.json` 里是 BYOK 预设：Yosei-Router、OpenAI、DeepSeek，加一个「自定义」。字段只有 `id` / `name` / `baseURL` / `models` / `keyUrl` / `docUrl`。游戏里不写余额、扣费、支付逻辑。

第一版只做 Chat Completions。Anthropic Messages 与 Responses 在界面上是灰态占位。

**自定义 Base URL 会做校验**：必须是 http(s)，且不能指向本机或内网（`localhost`、`127.0.0.1`、`10.x`、`172.16-31.x`、`192.168.x`、`169.254.x`、IPv6 唯一本地地址等）。这是防 SSRF：Base URL 由浏览器传入，服务端照着它发请求，不拦就能拿这个接口当跳板探测内网。

两点已知限制：

- 校验按主机名做，不解析 DNS。一个公网域名解析到内网 IP 仍能绕过。要堵死得在发请求前解析并比对 IP。
- Yosei-Router 的站点在 `https://router.dys.asia/`，接口地址是 `https://router.dys.asia/v1`。不带 `/v1` 会打到网页而不是接口，模型名写错一个字母也会直接 503。原型文档里的 `api.yosei.example` 是占位符，不要照抄。

## 以后加 Anthropic / Responses

提示词构建器只产出中立的 role + text（`lib/prompt`），适配器各自转格式，UI 不感知接口差异：

- **Anthropic Messages**：把 system 消息抽出来单独传 `system` 字段，其余转成 `messages`，`max_tokens` 必填。
- **OpenAI Responses**：转成 `input` 数组，**无状态调用**，每次传完整输入，不用 `previous_response_id`，不依赖服务端保存的会话状态。

新增适配器时实现 `ProviderAdapter.open()` 即可，连接期错误照样抛给路由转成真实状态码。

## 部署到 Vercel

1. 推到 GitHub / GitLab。
2. 在 [vercel.com/new](https://vercel.com/new) 导入。Vercel 会识别 Next.js 并用 `pnpm-lock.yaml` 自动选 pnpm。
3. 不用配环境变量。Key 由玩家在浏览器里填，服务端不持有。
4. `maxDuration` 由 `vercel.json` 设定：`app/api/chat/route.ts` 为 300 秒。

```bash
pnpm dlx vercel        # 预览
pnpm dlx vercel --prod # 生产
```

Vercel Hobby 只用于个人 / 非商业内测。游戏不收款、不做账；要收费必须先升 Pro。

## EPUB

会话菜单里「导出 EPUB」。生成和下载都在浏览器里完成，服务端不接收、不保存这个文件。

书里有标题、作者、日期、封面（有 CG 就用压过的 CG，否则用角色名画一张）、目录和章节。章节在场景切换、用户点了「在这里分章」、或满 30 轮玩家发言时切开。旁白和对白用不同的排版，可以关掉旁白。重新生成留下的几条里只导出当前选中的那条。`((…))` 和 `OOC：` 这类内容默认不导出，可以打开「包含 OOC」。图片先压到长边 800、大约 180KB 以内再嵌进去。

没有 EPUB 导入。角色卡导入只收 JSON，不认 `.epub`。

## 还没做

- Anthropic Messages / OpenAI Responses 适配器。
- 群聊多角色策略矩阵（按计划不做）。
