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
  description: "A board for orchestrating coding agents. Each note is one job, in its own worktree.",
  lang: "en-GB",
  cleanUrls: true,
  lastUpdated: true,
  // Private for now, so no sitemap and no analytics.
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "CLI", link: "/guide/cli" },
      { text: "Concepts", link: "/concepts/notes" },
      { text: "0.1.0-alpha.1", link: "/changelog" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Your first note", link: "/guide/first-note" },
          { text: "The CLI", link: "/guide/cli" },
          { text: "Reviewing work", link: "/guide/reviewing" },
          { text: "Agents and models", link: "/guide/agents" },
          { text: "Cost", link: "/guide/cost" },
          { text: "Using kandy from another agent", link: "/guide/skill" },
        ],
      },
      {
        text: "Concepts",
        items: [
          { text: "Notes and runs", link: "/concepts/notes" },
          { text: "Worktrees", link: "/concepts/worktrees" },
          { text: "The event log", link: "/concepts/event-log" },
          { text: "Steering", link: "/concepts/steering" },
        ],
      },
      {
        text: "Project",
        items: [
          { text: "Changelog", link: "/changelog" },
          { text: "What's unfinished", link: "/unfinished" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/hiteshbandhu/kandy" }],
    search: { provider: "local" },
    outline: [2, 3],
    footer: { message: "MIT", copyright: "kandy — alpha" },
  },
})
