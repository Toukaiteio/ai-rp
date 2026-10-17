# ai-rp

English | [中文](README_CN.md)

Through immersive dialogue, run an adventure, write a novel, learn about a character, or live through a story. Built with Next.js and deployable directly to Vercel.

The AI acts as narrator and relays everything that happens in the world, including the actions and words of characters. It never takes a role; the first person belongs to the player only.

BYOK: players supply their own API key in the browser. The server does not store keys or chat content, and no database is used.

## Deployment

Requirements: Node.js >= 20.9, pnpm 10.14.0.

### Local development

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000>. On first run, open Settings from the gear icon, choose a provider, paste a key, and select a model.

### Vercel

1. Push the repository to GitHub or GitLab.
2. Import it at <https://vercel.com/new>. Vercel detects Next.js and selects pnpm from `pnpm-lock.yaml`.
3. `maxDuration` is set in `vercel.json`: 300 seconds for `app/api/chat/route.ts` and `app/api/image/route.ts`.
4. No environment variables are required. `NEXT_PUBLIC_VAULT_SALT` and `NEXT_PUBLIC_VAULT_ITERATIONS` are optional defaults for the archive importer; see `.env.example`.

```bash
pnpm dlx vercel        # preview deployment
pnpm dlx vercel --prod # production deployment
```

### Self-hosted

```bash
pnpm build
pnpm start
```

Personal / non-commercial use only.
