/**
 * The MCP server Claude Code is pointed at with `--permission-prompt-tool`.
 *
 * A separate, tiny process, spawned by the agent itself from the config kandy
 * writes for the run. When the agent wants to do something its permission mode
 * will not let it do, Claude calls this tool instead of auto-denying; this
 * forwards the question to the daemon, the daemon holds it open and puts it on
 * the board, and whatever the user answers comes back here and is returned to
 * the agent.
 *
 * Deliberately dependency-free and deliberately not the MCP SDK: the surface
 * used is three JSON-RPC methods over newline-delimited stdio, and a sidecar
 * that an agent spawns on every run is a bad place to carry a dependency tree.
 *
 * stdout is the protocol. Nothing else may ever be written there.
 */
import { createInterface } from "node:readline"

const PROTOCOL_VERSION = "2024-11-05"

const URL_BASE = process.env["KANDY_URL"] ?? "http://127.0.0.1:4477"
const TOKEN = process.env["KANDY_TOKEN"] ?? ""
const RUN_ID = process.env["KANDY_RUN_ID"] ?? ""

type Rpc = { jsonrpc: "2.0"; id?: number | string | null; method?: string; params?: any }

const TOOL = {
  name: "permission_prompt",
  description:
    "Ask the person running this job whether to allow a tool call. Returns their answer.",
  inputSchema: {
    type: "object",
    properties: {
      tool_name: { type: "string" },
      input: { type: "object" },
      tool_use_id: { type: "string" },
    },
    required: ["tool_name", "input"],
  },
}

const rl = createInterface({ input: process.stdin })
rl.on("line", (line) => {
  if (!line.trim()) return
  let msg: Rpc
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  void dispatch(msg)
})

async function dispatch(msg: Rpc): Promise<void> {
  // Notifications carry no id and expect no reply — answering one is a
  // protocol error, not a harmless extra.
  const id = msg.id
  if (id === undefined || id === null) return

  switch (msg.method) {
    case "initialize":
      reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "kandy", version: "0.1.0" },
      })
      return

    case "tools/list":
      reply(id, { tools: [TOOL] })
      return

    case "tools/call": {
      if (msg.params?.name !== TOOL.name) {
        reply(id, verdict({ behavior: "deny", message: `no tool "${msg.params?.name}"` }))
        return
      }
      const args = msg.params?.arguments ?? {}
      reply(id, verdict(await askKandy(args["tool_name"], args["input"])))
      return
    }

    default:
      fault(id, `unsupported method ${msg.method}`)
  }
}

/**
 * Put the question to the daemon and wait for the answer.
 *
 * No timeout here on purpose: the daemon owns the clock, because the daemon is
 * what shows the question and what has to say in the transcript when nobody
 * answered it. A second timeout here would race that one and report the wrong
 * story.
 */
async function askKandy(tool: unknown, input: unknown): Promise<Verdict> {
  try {
    const res = await fetch(`${URL_BASE}/runs/${encodeURIComponent(RUN_ID)}/permission`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ tool: String(tool ?? "tool"), input: input ?? {} }),
    })
    const body = (await res.json()) as { verdict?: Verdict; error?: { message?: string } }
    if (!res.ok || !body.verdict) {
      return { behavior: "deny", message: body.error?.message ?? "kandy could not be asked" }
    }
    return body.verdict
  } catch (err) {
    // The board is unreachable. Denying is the only safe answer, and saying
    // why beats an agent guessing at a bare refusal.
    return {
      behavior: "deny",
      message: `kandy is not reachable, so nobody could be asked: ${String(err)}`,
    }
  }
}

type Verdict =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string }

/** Claude reads the verdict out of the tool result's text content, as JSON. */
function verdict(v: Verdict) {
  return { content: [{ type: "text", text: JSON.stringify(v) }] }
}

function reply(id: number | string, result: unknown): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n")
}

function fault(id: number | string, message: string): void {
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message } }) + "\n",
  )
}
