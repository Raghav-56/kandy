import { defineConfig } from "vitepress"

/**
 * kandy's docs.
 *
 * Deliberately small: a page per thing you would actually go looking for, and
 * the design notes kept separate from the how-to. The design notes are written
 * for someone deciding whether the architecture is right; the guide is written
 * for someone with a repo and ten minutes.
 */
export default defineConfig({
  title: "kandy",
  description: "A board for coding agents. Each note is one job, in its own worktree — alone, or as a team where everyone's work runs on their own machine.",
  lang: "en-GB",
  cleanUrls: true,
  head: [["link", { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }]],
  lastUpdated: true,
  // Private for now, so no sitemap and no analytics.
  themeConfig: {
    nav: [
      { text: "Get started", link: "/guide/getting-started" },
      { text: "Modes", link: "/modes/" },
      { text: "CLI", link: "/guide/cli" },
      { text: "Concepts", link: "/concepts/notes" },
      { text: "Status", link: "/status" },
    ],
    sidebar: [
      {
        text: "Start here",
        items: [
          { text: "How kandy works", link: "/guide/how-it-works" },
          { text: "Install and first run", link: "/guide/getting-started" },
          { text: "Your first note", link: "/guide/first-note" },
          { text: "Reviewing work", link: "/guide/reviewing" },
        ],
      },
      {
        text: "Three modes",
        items: [
          { text: "Which one is you", link: "/modes/" },
          { text: "Just you", link: "/modes/solo" },
          { text: "Join a team", link: "/modes/join" },
          { text: "Run a hub", link: "/modes/hub" },
          { text: "Hand work to someone", link: "/modes/handoff" },
          { text: "Who decides what", link: "/modes/permissions" },
        ],
      },
      {
        text: "Using it",
        items: [
          { text: "The terminal board", link: "/guide/terminal" },
          { text: "Agents and models", link: "/guide/agents" },
          { text: "Skills and MCP servers", link: "/guide/capabilities" },
          { text: "Cost", link: "/guide/cost" },
          { text: "From another agent", link: "/guide/skill" },
          { text: "CLI reference", link: "/guide/cli" },
        ],
      },
      {
        text: "Concepts",
        items: [
          { text: "Notes and runs", link: "/concepts/notes" },
          { text: "Worktrees", link: "/concepts/worktrees" },
          { text: "Hub and runners", link: "/concepts/hub-and-runners" },
          { text: "Briefings", link: "/concepts/briefings" },
          { text: "The event log", link: "/concepts/event-log" },
          { text: "Steering", link: "/concepts/steering" },
        ],
      },
      {
        text: "Project",
        items: [
          { text: "Status: extremely experimental", link: "/status" },
          { text: "Changelog", link: "/changelog" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/hiteshbandhu/kandy" }],
    search: { provider: "local" },
    outline: [2, 3],
    footer: { message: "MIT · extremely experimental", copyright: "kandy" },
  },
})
