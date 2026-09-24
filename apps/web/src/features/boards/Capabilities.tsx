import { useEffect, useState } from "react"
import type { KandyClient } from "@kandy/client"
import { checkMcpServers, type BoardView, type McpServer, type SkillInfo } from "@kandy/core"
import { Button, Dot, Input, Loading, Textarea } from "@/ui"

/**
 * What a board's agents can reach beyond the repository: skills and MCP servers.
 *
 * The two live in different places, and the UI says so. Skills are files in the
 * repo, so git is their transport — and an uncommitted one reaches no agent at
 * all. MCP servers live on the board, so they reach every agent on every machine,
 * each filling in its own secrets.
 */
export function Capabilities({
  view,
  client,
  onSaved,
}: {
  view: BoardView
  client: KandyClient
  onSaved: () => void
}) {
  return (
    <>
      <Skills boardId={view.board.id} client={client} />
      <McpServers view={view} client={client} onSaved={onSaved} />
    </>
  )
}

function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

function Skills({ boardId, client }: { boardId: string; client: KandyClient }) {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null)
  const [source, setSource] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setSkills(null)
    setError(null)
    client
      .skills(boardId)
      .then((r) => live && setSkills(r.skills))
      .catch((err) => live && setError(errorText(err)))
    return () => {
      live = false
    }
  }, [boardId, client])

  // Every skill call answers with the list as it now stands, so there is no
  // separate refetch to go stale.
  async function run(what: string, fn: () => Promise<{ skills: SkillInfo[] }>) {
    setBusy(what)
    setError(null)
    try {
      setSkills((await fn()).skills)
      return true
    } catch (err) {
      setError(errorText(err))
      return false
    } finally {
      setBusy(null)
    }
  }

  const uncommitted = skills?.filter((s) => !s.committed).length ?? 0
  const installing = busy === "install"

  return (
    <div>
      <h3 className="text-ui font-medium">Skills</h3>
      <p className="text-muted-foreground mt-1 max-w-[58ch] text-aux leading-relaxed">
        Instructions an agent loads when a task calls for them. They live in the repo, in{" "}
        <code className="font-mono">.agents/skills</code>.
      </p>

      {skills === null && !error ? (
        <p className="text-muted-foreground mt-3 flex items-center gap-2 text-aux">
          <Loading size={12} /> Reading skills…
        </p>
      ) : skills && skills.length > 0 ? (
        <ul className="border-border mt-3 divide-y rounded-lg border">
          {skills.map((s) => (
            <li key={s.name} className="flex items-center gap-3 px-3 py-2">
              <Dot tone={s.committed ? "mint" : "lemon"} />
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline gap-2">
                  <span className="font-mono text-aux">{s.name}</span>
                  {!s.committed && <span className="text-lemon text-meta">uncommitted</span>}
                </p>
                {s.description && (
                  <p className="text-muted-foreground truncate text-meta" title={s.description}>
                    {s.description}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                disabled={busy !== null}
                onClick={() => void run(`remove:${s.name}`, () => client.removeSkill(boardId, s.name))}
              >
                {busy === `remove:${s.name}` ? "Removing…" : "Remove"}
              </Button>
            </li>
          ))}
        </ul>
      ) : skills ? (
        <p className="text-muted-foreground/70 mt-3 text-meta">No skills in this repo yet.</p>
      ) : null}

      {/*
       * The one thing this section exists to say. A note runs in a worktree
       * checked out from git, so a skill that is only on disk is in none of the
       * places an agent actually runs.
       */}
      {uncommitted > 0 && (
        <div className="border-lemon/30 bg-lemon-bg mt-3 rounded-lg border px-3 py-2.5">
          <p className="max-w-[58ch] text-aux leading-relaxed">
            Agents only see committed skills — each note runs in a worktree checked out from git.
          </p>
          <Button
            size="sm"
            className="mt-2"
            disabled={busy !== null}
            onClick={() => void run("commit", () => client.commitSkills(boardId))}
          >
            {busy === "commit"
              ? "Committing…"
              : `Commit ${uncommitted} ${uncommitted === 1 ? "skill" : "skills"}`}
          </Button>
        </div>
      )}

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const src = source.trim()
          if (!src) return
          void run("install", () => client.addSkills(boardId, src)).then((ok) => ok && setSource(""))
        }}
      >
        <Input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="owner/repo"
          disabled={installing}
          className="w-[260px] font-mono text-aux"
          aria-label="Skill source"
        />
        <Button type="submit" size="sm" variant="outline" disabled={busy !== null || !source.trim()}>
          {installing ? (
            <>
              <Loading size={10} /> Installing…
            </>
          ) : (
            "Install"
          )}
        </Button>
      </form>
      {installing && (
        <p className="text-muted-foreground/70 mt-1.5 text-meta">
          Fetching from GitHub — this can take up to a minute.
        </p>
      )}
      {error && <p className="text-berry mt-1.5 text-meta">{error}</p>}
    </div>
  )
}

/** Header or env names that usually carry a credential. */
const SECRET_NAME = /authorization|token|key|secret|password/i

/** Any value in the form that looks like a credential typed in literally. */
function literalSecrets(pairs: Record<string, string>) {
  return Object.entries(pairs)
    .filter(([k, v]) => SECRET_NAME.test(k) && v.trim() && !/\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(v))
    .map(([k]) => k)
}

/** `KEY=VALUE` or `Name: Value` lines into a map; the first bad line is the error. */
function parseLines(text: string, sep: "=" | ":"): Record<string, string> | string {
  const out: Record<string, string> = {}
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line) continue
    const i = line.indexOf(sep)
    if (i <= 0) return `"${line}" should be ${sep === "=" ? "KEY=VALUE" : "Name: Value"}`
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

function McpServers({
  view,
  client,
  onSaved,
}: {
  view: BoardView
  client: KandyClient
  onSaved: () => void
}) {
  const servers = view.board.mcp ?? []
  const [name, setName] = useState("")
  const [type, setType] = useState<McpServer["type"]>("stdio")
  const [command, setCommand] = useState("")
  const [url, setUrl] = useState("")
  const [pairs, setPairs] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sep = type === "stdio" ? "=" : ":"
  const parsed = parseLines(pairs, sep)
  const warn = typeof parsed === "string" ? [] : literalSecrets(parsed)

  async function save(what: string, next: McpServer[]) {
    const checked = checkMcpServers(next)
    if (!checked.ok) {
      setError(checked.error)
      return false
    }
    setBusy(what)
    setError(null)
    try {
      await client.setMcp(view.board.id, checked.servers)
      onSaved()
      return true
    } catch (err) {
      setError(errorText(err))
      return false
    } finally {
      setBusy(null)
    }
  }

  function add() {
    if (typeof parsed === "string") return setError(parsed)
    const n = name.trim()
    let server: McpServer
    if (type === "stdio") {
      const [cmd = "", ...args] = command.trim().split(/\s+/)
      server = {
        name: n,
        type,
        command: cmd,
        ...(args.length ? { args } : {}),
        ...(Object.keys(parsed).length ? { env: parsed } : {}),
      }
    } else {
      server = {
        name: n,
        type,
        url: url.trim(),
        ...(Object.keys(parsed).length ? { headers: parsed } : {}),
      }
    }
    // Same name replaces: that is how a server is edited.
    void save("add", [...servers.filter((s) => s.name !== n), server]).then((ok) => {
      if (!ok) return
      setName("")
      setCommand("")
      setUrl("")
      setPairs("")
    })
  }

  return (
    <div className="mt-6">
      <h3 className="text-ui font-medium">MCP servers</h3>
      <p className="text-muted-foreground mt-1 max-w-[58ch] text-aux leading-relaxed">
        Tools every agent on this board can call, on every machine that runs its notes.
      </p>

      {servers.length > 0 && (
        <ul className="border-border mt-3 divide-y rounded-lg border">
          {servers.map((s) => {
            const keys = Object.keys((s.type === "stdio" ? s.env : s.headers) ?? {})
            return (
              <li key={s.name} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline gap-2">
                    <span className="font-mono text-aux">{s.name}</span>
                    <span className="text-muted-foreground/70 text-meta">
                      {s.type === "stdio" ? "local" : "remote"}
                    </span>
                  </p>
                  <p className="text-muted-foreground truncate font-mono text-meta">
                    {s.type === "stdio" ? [s.command, ...(s.args ?? [])].join(" ") : s.url}
                    {keys.length > 0 && ` · ${keys.join(", ")}`}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground"
                  disabled={busy !== null}
                  onClick={() =>
                    void save(
                      `remove:${s.name}`,
                      servers.filter((x) => x.name !== s.name),
                    )
                  }
                >
                  {busy === `remove:${s.name}` ? "Removing…" : "Remove"}
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      <form
        className="border-border mt-3 space-y-3 rounded-lg border p-3"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="name"
            className="w-[180px] font-mono text-aux"
            aria-label="Server name"
          />
          <div className="flex gap-1">
            {(
              [
                ["stdio", "Local command"],
                ["http", "Remote URL"],
              ] as const
            ).map(([t, label]) => (
              <Button
                key={t}
                type="button"
                size="sm"
                variant={type === t ? "default" : "outline"}
                onClick={() => setType(t)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>

        {type === "stdio" ? (
          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="npx -y @modelcontextprotocol/server-github"
            className="font-mono text-aux"
            aria-label="Command"
          />
        ) : (
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://mcp.linear.app/mcp"
            className="font-mono text-aux"
            aria-label="URL"
          />
        )}

        <label className="block">
          <span className="label">{type === "stdio" ? "Environment" : "Headers"} (optional)</span>
          <Textarea
            value={pairs}
            onChange={(e) => setPairs(e.target.value)}
            placeholder={
              type === "stdio"
                ? "GITHUB_TOKEN=${GITHUB_TOKEN}"
                : "Authorization: Bearer ${LINEAR_TOKEN}"
            }
            rows={2}
            className="mt-1.5 min-h-12 font-mono text-aux"
          />
          <span className="text-muted-foreground/70 mt-1.5 block text-meta">
            Write secrets as <code className="font-mono">{"${NAME}"}</code> — each machine fills
            them from its own environment.
          </span>
        </label>

        {warn.length > 0 && (
          <p className="text-lemon text-meta">
            {warn.join(", ")} {warn.length === 1 ? "looks" : "look"} like a secret typed in
            directly. It would be stored on the board and sent to every machine — consider{" "}
            <code className="font-mono">{"${NAME}"}</code> instead.
          </p>
        )}
        {error && <p className="text-berry text-meta">{error}</p>}

        <Button
          type="submit"
          size="sm"
          disabled={
            busy !== null || !name.trim() || !(type === "stdio" ? command.trim() : url.trim())
          }
        >
          {busy === "add"
            ? "Saving…"
            : servers.some((s) => s.name === name.trim())
              ? "Replace server"
              : "Add server"}
        </Button>
      </form>
    </div>
  )
}
