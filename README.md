# ai-rp

English | [中文](README_CN.md)

Through immersive dialogue, run an adventure, write a novel, learn about a character, or live through a story. Built with Next.js and deployable directly to Vercel.

The AI acts as narrator and relays everything that happens in the world, including the actions and words of characters. It never takes a role; the first person belongs to the player only.

BYOK: players supply their own API key in the browser. The server does not store keys or chat content, and no database is used.

Common SillyTavern read-only card macros are expanded for display and model requests while original card templates are preserved. See [macro compatibility and limitations](doc/macros-compatibility.md); this is not a full STscript or variable runtime.

## Deployment

Requirements: Node.js 22.19.0 (`.nvmrc`), pnpm 10.14.0.

### Local development

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:3000>. On first run, open Settings from the gear icon, choose a provider, paste a key, and select a model.

### Local card translation

Open the shelf's **Local** tab and choose **Translate to English** (or **翻译为中文** in the Chinese interface) beneath a card. The target follows the current interface language. Translation uses the currently configured model and saves a separate, encrypted local card, leaving the original and conversations unchanged. The character name is translated first and supplied as a fixed glossary for text, greetings and worldbook contents. Matching dialogue speaker attributes are synchronized; `{{char}}` macros are retained. Attribution, portraits and other metadata are preserved. Names already appropriate in the target language may remain unchanged.

The confirmation explains model-credit usage and content sharing. Its themed **Don't remind me again** checkbox remembers consent in this browser only after confirmation. Large cards use multiple requests. Cancel stops further work but cannot refund any provider usage already incurred. Invalid or incomplete output is not saved. Worldbook OR keywords gain translated synonyms; AND keywords stay unchanged to preserve matching semantics.

The dialog shows the current field, verified segments, completed source-character percentage and output characters received in this attempt. Only successful persistence reaches 100%. Segments prefer paragraph and sentence boundaries. Translation requests use low reasoning effort with no automatic paid retries. Errors distinguish output limits, content filtering, interrupted streams, truncated JSON, missing fields and damaged protected markers. Keep the dialog open and choose **Continue translation** to reuse verified segments. **Retry saving** reuses the complete translated card without another model call. This cache lives only in memory and is cleared on close, cancellation, or changes to the card, language or model configuration.

### Tests

After installing dependencies, the single offline test command is:

```bash
pnpm test
```

No model key or network access is needed for these tests. Also run `pnpm lint` and `pnpm build` before deployment. A clean build needs network access to download the Google fonts used by Next.js.

### Docker (Linux)

```bash
docker build -t ai-rp .
docker run --rm -p 3000:3000 ai-rp
```

The Dockerfile pins Node and pnpm, installs the frozen lockfile locally in the image, runs offline tests, and builds the production app. No extra OS packages or server-side model secrets are required. Open <http://localhost:3000> and configure your provider in the browser. The first image build requires network access for dependencies and fonts.

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
