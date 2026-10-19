# SillyTavern 文本宏兼容

规则依据：[SillyTavern 官方 Macros 文档](https://docs.sillytavern.app/usage/core-concepts/macros/)。这里实现角色卡常用的只读文本宏，不是完整的酒馆运行时。

## 已支持

| 类别 | 宏或标记 |
| --- | --- |
| 名称 | `{{char}}`、`{{user}}`、`{{group}}`、`{{groupNotMuted}}`、`{{charIfNotGroup}}`、`{{notChar}}` |
| 旧式名称 | `<USER>`、`<BOT>`、`<CHAR>`、`<GROUP>`、`<CHARIFNOTGROUP>` |
| 角色卡 | `{{description}}`、`{{personality}}`、`{{scenario}}`、`{{charPrompt}}`、`{{charInstruction}}`、`{{charDepthPrompt}}`、`{{charCreatorNotes}}`、`{{charVersion}}`、`{{mesExamplesRaw}}` |
| 开场白 | `{{charFirstMessage}}` 为主开场白，`{{charFirstMessage::1}}` 为第一个备选，后续依次递增 |
| 玩家和作者注 | `{{persona}}`、`{{authorsNote}}`、`{{charAuthorsNote}}`；需要对应上下文 |
| 历史 | `{{lastMessage}}`、`{{lastUserMessage}}`、`{{lastCharMessage}}`、`{{lastMessageId}}`、`{{summary}}`、`{{input}}` |
| 文本工具 | `{{newline}}`、`{{newline::2}}`、`{{space}}`、`{{space::2}}`、`{{noop}}`、`{{trim}}`、`{{reverse::text}}` |
| 注释 | `{{// 注释}}`、`{{//}}多行注释{{///}}` |

宏名大小写不敏感，允许宏名和参数分隔符周围的空白。支持 `::`、空格和旧单冒号参数，以及内层优先的嵌套，例如 `{{reverse::{{char}}}}`。反斜杠转义的 `\{\{char\}\}` 显示字面 `{{char}}`，不会在本次处理中继续展开。`reverse` 支持成对作用域及 `#` 保留空白标志。

卡字段可以互相引用。人物姓名和历史引用按字面值插入，不执行它们携带的宏；循环引用保留循环位置的宏，并限制递归、处理次数和输出大小。

## 生效位置

- 本地角色架简介、开场白、已有历史、普通及流式消息的展示和复制。
- 模型提示词中的角色字段、历史、作者注、声音和世界书；世界书关键词先展开再匹配，预算按展开后的正文计算。
- 服务端聊天回退保留开场白、版本和扩展字段上下文，与浏览器组装一致。
- EPUB 阅读正文展开后再转义 HTML。聊天块先按原文解析，再展开正文和说话人，避免姓名中的引号或标签改变消息结构。
- 质量门识别名称宏的真实身份：`who="{{char}}"` 不误判为陌生角色，`who="{{user}}"` 仍按替玩家发言检查。

编辑器、卡片 JSON/PNG 导出、翻译输入及存档保留原宏。旧版本已经保存成具体姓名的文本无法自动还原为宏。文本超出宏引擎的资源限制时明确报错，不静默截断。

## 兼容边界

- 应用当前是单角色聊天；未提供群组上下文时，群组宏遵循 solo 语义，不新增群聊功能。
- 未知宏、缺少上下文的宏及不支持的作用域原样保留，不静默删除。已知空字段可以展开为空。
- `{{original}}` 在角色卡覆盖核心系统提示时对应默认核心规则；其他位置不猜测缺失的原始模板。
- `{{mesExamples}}` 需要调用方提供 instruct 模板格式化结果；本项目没有酒馆 instruct 模式，实际卡片请用 `{{mesExamplesRaw}}`。
- 暂不支持 `setvar/getvar`、全局变量、变量简写、`if/else`、随机/掷骰宏、时间宏、STscript、斜杠命令、正则扩展、扩展专用宏和任意 JavaScript。它们与只读替换不是同一种能力，不会被冒充为已兼容。

## 离线验证

`pnpm test` 包含宏语法、嵌套和转义、未知保留、循环和资源边界、聊天显示、世界书匹配、服务端上下文、质量门及 EPUB 转义测试，不调用收费模型。
