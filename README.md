# ai-rp

ai-rp is a browser-based role-playing writing environment for producing a genuinely personal novel through immersive dialogue. You bring the character, setting, and player decisions; the model provides narration, character dialogue, scene movement, and continuity. The result is not a generic chat transcript but a story that develops around the choices made in one specific session.

The application is built with Next.js and is deployable to Vercel or any compatible Node.js host. It uses a BYOK model configuration: provider credentials are entered by the user, encrypted locally, and are not stored by the server.

## What it does

- **Immersive dialogue as the primary writing interface**: play a scene turn by turn and let the story become a novel organically.
- **Character cards**: import and export Character Card V2 JSON/PNG data, including greetings, lorebooks, macros, and voice profiles.
- **Continuity controls**: maintain scene state, unfinished story threads, layered long-term memory, author notes, and branch conversations.
- **Generation quality gates**: validate structured response blocks, detect player-action violations and repetition, and repair structural failures before they enter history.
- **Prompt observability**: inspect the assembled prompt, token budget, activated lorebook entries, scene state, story threads, and turn plan in development mode.
- **Novel export**: select the current swipe, remove or retain OOC text and narration, split the session into chapters, and export a standards-compatible EPUB with a cover, table of contents, formatted dialogue, and embedded scene images.
- **Local-first data**: encrypted sessions, cards, settings, memories, and branches remain on the client. Use archive export/import for backup and migration.

Common read-only SillyTavern macros are expanded for display and model requests while the original card templates remain unchanged. This is intentionally not a full STscript or variable-runtime implementation.

## Requirements

- Node.js 22.19.0, pinned in `.nvmrc`
- pnpm 10.14.0, pinned in `package.json`
- A model provider and API key configured in the application for live generation

## Development

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:3000>. Configure a provider from Settings, then create or import a character card and start a session.

## Tests and validation

The offline test suite does not require a model key or network access:

```bash
pnpm test
```

Before deployment, run the complete application checks:

```bash
pnpm lint
pnpm build
```

The role-play regression checks are also offline unless the `--live` variant is used:

```bash
pnpm test:roleplay
pnpm repair-check
pnpm state-check
pnpm lorebook-check
pnpm voice-check
pnpm regenerate-check
```

Live evaluation reads the key from `YOSEI_API_KEY` or `BASELINE_API_KEY` and never writes it to result files:

```bash
pnpm test:roleplay:live
```

## EPUB export

EPUB export runs in the browser and does not upload the session. The exporter:

1. Uses the selected swipe for each assistant message;
2. Starts chapters on an explicit chapter marker, a real scene change, or every 30 player turns when no stronger boundary exists;
3. Renders narration, actions, dialogue, scenes, and player turns as separate semantic blocks;
4. Escapes generated text before inserting it into XHTML;
5. Adds a generated or scene-image cover, a title page, a table of contents, EPUB metadata, and embedded JPEG assets;
6. Keeps OOC filtering and narration inclusion under explicit export options.

The generated file is an EPUB 2 container produced with `jepub` and `JSZip`, with the required `mimetype`, `META-INF/container.xml`, OPF package, NCX navigation, XHTML pages, and image manifest entries.

## Docker

```bash
docker build -t ai-rp .
docker run --rm -p 3000:3000 ai-rp
```

The Dockerfile pins Node and pnpm, installs from the lockfile, runs the offline tests, and builds the production application. Provider keys remain runtime user configuration and are not copied into the image.

## Deployment

### Vercel

Import the repository at <https://vercel.com/new>. Vercel detects Next.js and uses `pnpm-lock.yaml`. API route duration is configured in `vercel.json`.

### Self-hosted Node.js

```bash
pnpm build
pnpm start
```

The server assembles and streams model requests but does not persist keys, sessions, or chat content. The client is responsible for encrypted local storage and archive backups.

## Evaluation and observability

Development mode exposes a QA panel with generation reports and prompt structure. Reports track block validity, `act` compliance, player-action violations, repetition, language alignment, and the final quality-gate decision without persisting message content.

The design is deliberately layered:

- stable prompt rules and card context are separated from turn-local instructions;
- scene state records current facts without silently converting model guesses into canon;
- story threads are selected by scene relevance and budget;
- memory writes require an explicit reason and preserve conflicts rather than overwriting established facts;
- voice profiles constrain delivery without turning the prompt into a checklist.

## Brand assets

The processed desktop/PWA icon is in [`public/brand/`](public/brand/) and is currently used for the favicon and application icon. The extracted logo and chibi assets are kept there for possible future placement; the unused lower-left draft was omitted.

## Privacy and backups

The browser stores encrypted application data locally. Browser storage is persistent across normal restarts but remains subject to browser quota and site-data cleanup. Export archives regularly if the session is valuable, and keep a copy outside the browser profile.

## Next development tasks

The following work is planned and is not represented as completed functionality in the current web build:

- **PC application**: provide a dedicated desktop client with a stable application data directory and a native packaging/update path using the existing storage adapter boundary.
- **Android app**: provide a dedicated Android client with native lifecycle handling, application-private storage, and a reproducible release build using the same adapter boundary.

## Known issues

- **Archive persistence is not yet reliable enough**: the current browser storage path is still subject to browser quota, privacy mode behavior, site-data cleanup, and implementation differences between browsers. Export archives should be treated as the reliable backup mechanism until the native storage plan is implemented.
- **Images do not yet have a dedicated asset store**: generated scene images are still represented inside encrypted application data and are not yet separated into independently managed asset files or synchronized across devices.

Personal / non-commercial use only.
