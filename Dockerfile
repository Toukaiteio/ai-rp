FROM node:22.19.0-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm test && pnpm build
RUN chown -R node:node /app/.next

FROM build AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
EXPOSE 3000
USER node
CMD ["pnpm", "start", "--hostname", "0.0.0.0"]
