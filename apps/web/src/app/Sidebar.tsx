import {
  Check,
  ChevronsUpDown,
  FolderGit2,
  Gauge,
  LayoutList,
  Moon,
  Plus,
  Settings2,
  Sun,
} from "lucide-react"
import type { AgentInfo, Board, BoardView } from "@kandy/core"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Hint,
  Kbd,
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  StatusPill,
  useSidebar,
} from "@/ui"
import { Logo } from "@/brand/Logo"
import { AgentMark, agentLabel } from "@/features/agents/AgentMark"
import type { Theme } from "@/hooks/useTheme"
import { cn, money } from "@/lib/utils"

/* kandy's row: 13px and 34px tall, against shadcn's 14px and 32px. Applied in
   one place so the nav, the footer and anything added later cannot drift. */
const ROW = "h-[34px] text-[13px]"

export type View = "board" | "usage" | "settings"

/**
 * Standing context and navigation.
 *
 * Everything here is a fact about the whole workspace rather than about one
 * note, which is why none of it belongs in the list. It never gets covered by
 * anything: losing sight of what else is waiting is the one thing this app
 * cannot afford to do.
 *
 * Built on shadcn's sidebar so the behaviour people expect comes for free —
 * ⌘B to collapse to an icon rail, a real sheet on a phone, tooltips that
 * appear only once the labels are gone, and the open/closed choice remembered.
 *
 * The repo list became a switcher in the header. A flat list of repos read as
 * navigation, which it is not: the repo is the *context* every other thing in
 * here is about, and the board, the spend and the agent list all change
 * meaning when it changes. It is also the one shape that survives the icon
 * rail, where a list of names has nothing left to show.
 */
export function Sidebar({
  boards,
  boardId,
  view,
  agents,
  page,
  theme,
  onPage,
  onTheme,
  onBoardChange,
  onNewBoard,
  onNewNote,
}: {
  boards: Board[]
  boardId: string | null
  view: BoardView | null
  agents: AgentInfo[]
  page: View
  theme: Theme
  onPage: (v: View) => void
  onTheme: (t: Theme) => void
  onBoardChange: (id: string) => void
  onNewBoard: () => void
  onNewNote: () => void
}) {
  const notes = view?.notes ?? []
  const n = (f: (s: string) => boolean) => notes.filter((x) => f(x.status)).length
  const attention = n((s) => s === "blocked" || s === "failed")
  // Ahead of everything, including `attention`: an agent standing still with a
  // question is the one thing on a board that cannot make progress without you.
  const waiting = view?.prompts.length ?? 0
  const review = n((s) => s === "review")
  const running = n((s) => s === "running")

  const runs = view?.runs ?? []
  const spend = runs.reduce((t, r) => t + (r.costUsd ?? 0), 0)
  const estimated = runs.some((r) => r.costSource === "estimated")

  const current = boards.find((b) => b.id === boardId) ?? null

  /* One badge, not four. The list already shows every status; what belongs
     here is the single most urgent thing, so the rail can carry it too. */
  const badge =
    waiting > 0
      ? { tone: "lemon" as const, count: waiting, pulse: true }
      : attention > 0
        ? { tone: "berry" as const, count: attention, pulse: true }
        : review > 0
          ? { tone: "mint" as const, count: review, pulse: false }
          : running > 0
            ? { tone: "lemon" as const, count: running, pulse: true }
            : null

  return (
    <SidebarRoot collapsible="icon">
      <SidebarHeader className="border-sidebar-border border-b p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  tooltip={current ? `${current.name} — switch repo` : "Choose a repo"}
                  className="data-[state=open]:bg-sidebar-accent"
                >
                  <Logo size={22} className="shrink-0" />
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate text-[13.5px] font-semibold tracking-[-0.02em]">
                      {current?.name ?? "kandy"}
                    </span>
                    <span className="text-muted-foreground truncate text-[11px]">
                      {current ? shortPath(current.repoPath) : "no repo yet"}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-3.5 shrink-0 opacity-60" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>

              <DropdownMenuContent
                align="start"
                side="bottom"
                sideOffset={6}
                className="w-[--radix-dropdown-menu-trigger-width] min-w-[220px]"
              >
                <DropdownMenuLabel className="label">Repos</DropdownMenuLabel>
                {boards.map((b) => (
                  <DropdownMenuItem
                    key={b.id}
                    onSelect={() => {
                      onBoardChange(b.id)
                      onPage("board")
                    }}
                    className="gap-2"
                  >
                    <FolderGit2 className="size-3.5 shrink-0 opacity-70" />
                    <span className="min-w-0 flex-1 truncate">{b.name}</span>
                    {b.id === boardId && <Check className="text-mint size-3.5 shrink-0" />}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onNewBoard} className="gap-2">
                  <Plus className="size-3.5 shrink-0" />
                  Add a repo
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Writing a note leads, because it is what you came to do. */}
              <SidebarMenuItem>
                <SidebarMenuButton onClick={onNewNote} tooltip="New note" className={ROW}>
                  <Plus />
                  <span>New note</span>
                </SidebarMenuButton>
                <SidebarMenuBadge className="group-data-[collapsible=icon]:hidden">
                  <Kbd>C</Kbd>
                </SidebarMenuBadge>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  className={ROW}
                  isActive={page === "board"}
                  onClick={() => onPage("board")}
                  tooltip={badge ? `Board — ${badge.count} need you` : "Board"}
                >
                  <LayoutList />
                  <span>Board</span>
                </SidebarMenuButton>
                {badge && (
                  <SidebarMenuBadge>
                    <StatusPill
                      tone={badge.tone}
                      pulse={badge.pulse}
                      className="px-1.5 py-0 text-[10px]"
                    >
                      {badge.count}
                    </StatusPill>
                  </SidebarMenuBadge>
                )}
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  className={ROW}
                  isActive={page === "usage"}
                  onClick={() => onPage("usage")}
                  tooltip={spend > 0 ? `Usage — ${estimated ? "≈" : ""}${money(spend)}` : "Usage"}
                >
                  <Gauge />
                  <span>Usage</span>
                </SidebarMenuButton>
                {spend > 0 && (
                  <SidebarMenuBadge className="text-muted-foreground tabular-nums group-data-[collapsible=icon]:hidden">
                    {estimated ? "≈" : ""}
                    {money(spend)}
                  </SidebarMenuBadge>
                )}
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  className={ROW}
                  isActive={page === "settings"}
                  onClick={() => onPage("settings")}
                  tooltip="Settings"
                >
                  <Settings2 />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

      </SidebarContent>

      <SidebarFooter className="border-sidebar-border border-t p-2">
        <SidebarGroup className="group-data-[collapsible=icon]:hidden p-0 pb-1">
          <SidebarGroupLabel className="label h-auto px-2 pt-0 pb-1.5 text-[10.5px]">
            Agents
          </SidebarGroupLabel>
          <SidebarGroupContent className="flex flex-col gap-1 px-2">
            {agents
              .filter((a) => a.installed)
              .map((a) => (
                <Hint
                  key={a.id}
                  text={`${agentLabel(a.id)}${a.version ? ` — ${a.version}` : ""}${a.authed ? "" : " · not signed in"}`}
                >
                  <span className="flex w-fit items-center gap-2 py-0.5">
                    <AgentMark agent={a.id} size={13} />
                    <span
                      className={cn(
                        "text-[11.5px]",
                        a.authed ? "text-muted-foreground" : "text-muted-foreground/50",
                      )}
                    >
                      {agentLabel(a.id)}
                    </span>
                  </span>
                </Hint>
              ))}
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className={ROW}
              onClick={() => onTheme(theme === "dark" ? "light" : "dark")}
              tooltip={theme === "dark" ? "Switch to light" : "Switch to dark"}
            >
              {theme === "dark" ? <Sun /> : <Moon />}
              <span>{theme === "dark" ? "Light" : "Dark"}</span>
            </SidebarMenuButton>
            <SidebarMenuBadge className="text-muted-foreground/70 group-data-[collapsible=icon]:hidden">
              <Kbd>⌘K</Kbd>
            </SidebarMenuBadge>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      {/* Drag or click the edge to collapse — the affordance ⌘B doesn't give. */}
      <SidebarRail />
    </SidebarRoot>
  )
}

/** `/Users/me/Developer/kandy` → `~/Developer/kandy`, and never more than a line. */
function shortPath(p: string): string {
  const home = p.match(/^\/(?:Users|home)\/[^/]+/)
  const rel = home ? `~${p.slice(home[0].length)}` : p
  return rel.length <= 30 ? rel : `…${rel.slice(-29)}`
}
