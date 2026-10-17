# ai-rp

[English](README.md) | 中文

通过沉浸式对话来进行一场冒险、创作一本小说、了解一个人物、体验一个故事。使用 Next.js 开发，可直接部署于 Vercel。

## 部署

环境要求：Node.js >= 20.9，pnpm 10.14.0。

### 本地开发

```bash
pnpm install
pnpm dev
```

打开 <http://localhost:3000>。首次使用点右上角齿轮进入「连接设置」，选择提供商、粘贴 Key、选择模型。

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
