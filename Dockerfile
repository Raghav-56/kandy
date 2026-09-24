# kandy hub — the board a team shares.
#
# A hub keeps the event log, serves the board, and relays between people and
# their runners. It never runs an agent, never holds a provider key, never
# touches a repository — so this image has no agent CLIs, no git credentials,
# and nothing to run them with.
#
# Runners are never containerised. A runner uses its person's installed agents
# and their logins, and Claude Code's lives in the macOS keychain — a runner in
# a container would be pooled credentials by another name. Run `kandy runner`
# on each laptop instead.
#
#   docker build -t kandy-hub .
#   docker compose up          (see compose.yaml, with a Tailscale sidecar)

FROM node:22-slim AS build
WORKDIR /src
RUN corepack enable
COPY . .
# By path, not by name: the monorepo's root package is also called `kandy`, and
# a name filter would build everything in it — the docs site included.
# In order, spelled out: core, the client that imports it, the web app that
# imports both, and last the server, whose own build copies the web bundle
# into itself and must find one there.
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @kandy/core build \
 && pnpm --filter @kandy/client build \
 && pnpm --filter @kandy/web build \
 && pnpm --filter ./apps/server build \
 && pnpm --filter ./apps/server deploy --prod --legacy /out

FROM node:22-slim
# Nothing but node and the built package: no git, no agent CLIs. A hub that
# cannot run them cannot be talked into running them.
WORKDIR /app
COPY --from=build /out /app

# State — the log, the token — on a volume, so a new image is not a new hub.
ENV XDG_STATE_HOME=/data \
    XDG_CONFIG_HOME=/data \
    XDG_DATA_HOME=/data \
    NODE_ENV=production
VOLUME ["/data"]

# Not root: a hub has no business with anything root could reach.
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 4477
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.KANDY_PORT||4477)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# Loopback by default: with a Tailscale sidecar sharing this network, that is
# the only address the sidecar needs and the only one identity is safe on.
ENTRYPOINT ["node", "/app/dist/cli.js", "hub"]
CMD ["--port", "4477"]
