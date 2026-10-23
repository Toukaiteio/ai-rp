# Phase 13：角色卡 attachment

attachment 是角色卡携带的声明式能力。第一期不执行卡片里的代码，只解析内置类型并在当前角色卡的聊天工作区展示。

## 卡片格式

扩展放在 `data.extensions["ai-rp"].attachments`。角色卡仍然使用 Character Card V2，未知 attachment 会保留但不会执行。

```json
{
  "data": {
    "extensions": {
      "ai-rp": {
        "attachments": [
          {
            "id": "world-map",
            "kind": "map",
            "version": "1",
            "title": "世界地图",
            "generation": {
              "mode": "CUSTOM",
              "generator": { "id": "procedural-world-v1", "version": "1" },
              "seed": "ashen-moon",
              "parameters": { "continents": 3 },
              "random": {
                "islandDensity": { "type": "float", "min": 0.04, "max": 0.16 }
              }
            }
          }
        ]
      }
    }
  }
}
```

`parameters` 是固定值。`random` 是新会话初始化时抽取的参数范围。同一会话不会重复抽取，运行态保存在会话的 `attachmentState`，不写回角色卡。

## 地图

地图生成配置包含：

- `DEFAULT`：内置现实世界地图预设，当前有 `earth-simplified`、`earth-political`、`earth-physical`、`earth-oceanic`，版本为 `1`。
- `CUSTOM`：`generator`、字符串 `seed`、固定 `parameters` 和可选 `random`。
- `generator.version`：生成算法版本。改算法时保留旧版本，避免旧卡变图。

地图形状是运行时结果，不进入卡片。CUSTOM 使用确定性生成器，不调用网络、文件系统、`Math.random` 或脚本执行器。DEFAULT 使用应用内置的地理栅格数据。

## 内置类型

- `map`：生成地图、选择区域、查看区域信息。
- `codex`：显示卡片携带的条目。
- `script`：当前只保存声明，强制 `network: false`、`filesystem: false`、`cardScope: true`，状态为 `unsupported`，不会执行。作者请求的权限放在 `requestedPermissions`，不代表宿主授予权限。

## AI 工具

模型需要读取或修改 attachment 时，使用工具调用，不把 JSON 或函数标签写进剧情正文：

- `attachment_query`：查询地图摘要、区域，Codex 条目，或脚本的安全状态。
- `attachment_update`：声明式修改地图生成配置，或增删改 Codex 条目。

工具结果只作用于当前会话的运行态覆盖。地图和 Codex 的修改不会自动写回角色卡；用户在角色卡编辑器中保存后才进入卡片。脚本工具只返回安全状态，任何脚本更新和执行都会被拒绝。

## 界面

聊天顶栏只在当前卡存在可用 attachment 时显示入口：

- 宽屏桌面：右侧面板。
- 中等视口：覆盖式工作区。
- 窄屏或矮视口：全屏工作区。

地图区域详情在移动端使用底部面板。attachment 不增加 AppShell 的顶层页面。
