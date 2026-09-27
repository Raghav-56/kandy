<script setup lang="ts">
import { computed, ref } from "vue"
import stats from "../../data/stats.json"

/**
 * The landing page.
 *
 * The product is the picture. Every image here is the real app, captured from
 * a real board where real agents did the work — nothing mocked, nothing drawn —
 * and each comes in the theme you're reading in. Copy stays short and plain;
 * the screenshots carry what copy can only claim.
 */
const INSTALL = "npm i -g https://github.com/hiteshbandhu/kandy/releases/latest/download/kandy.tgz"

const copied = ref<string | null>(null)
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = text
    setTimeout(() => (copied.value = null), 1400)
  } catch {
    // Clipboard access can be refused. The command is selectable either way.
  }
}

// From `kandy stats --json` via scripts/stats.mjs — a number on a landing page
// is a claim, and this one is checkable.
const num = (n: number) => n.toLocaleString("en-US")
const STATS = computed(() => [
  { n: num(stats.landed), label: "notes landed" },
  { n: num(stats.runs), label: "agent runs" },
  { n: `+${num(stats.insertions)}`, label: "lines written" },
  { n: `${stats.estimated ? "≈" : ""}$${stats.usd.toFixed(2)}`, label: "spent on agents" },
])
const taken = computed(() =>
  new Date(stats.takenAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
)

const shot = (name: string) => ({ light: `/shots/site/${name}-light.webp`, dark: `/shots/site/${name}-dark.webp` })

const MACHINES = [
  { who: "Your laptop", notes: "your notes, your logins", agent: "Claude Code", color: "#d97757" },
  { who: "Sam's laptop", notes: "Sam's notes, Sam's logins", agent: "Codex", color: "#8a8794" },
  { who: "Priya's laptop", notes: "Priya's notes, Priya's logins", agent: "Cursor", color: "#7a63cf" },
]

const MODES = [
  {
    name: "Just you",
    cmd: "kandy",
    text: "The board, the agents and the work all on your machine. The default.",
    href: "/modes/solo",
  },
  {
    name: "Join a team",
    cmd: "kandy join <hub-url>",
    text: "Your team's shared board. Your notes still run here, with your agents and logins.",
    href: "/modes/join",
  },
  {
    name: "Run a hub",
    cmd: "kandy hub --tailscale",
    text: "Keeps the board and runs nothing — no agents, no keys, no repositories.",
    href: "/modes/hub",
  },
]
</script>

<template>
  <div class="kh">
    <!-- ── hero ─────────────────────────────────────────────────────────── -->
    <section class="kh-hero">
      <img class="kh-mark" src="/logo.svg" alt="" width="56" height="56" />
      <a class="kh-pill" href="/status">
        <span class="kh-pill-dot" />0.2 alpha — extremely experimental<span class="kh-arrow">→</span>
      </a>

      <h1 class="kh-title">Hand off the work.<br /><span>Review the diff.</span></h1>

      <p class="kh-lead">
        kandy is a board for coding agents. Write a note, and Claude Code, Codex or Cursor does the
        job in its own git worktree — several at once, on your machine. Each one comes back as a
        diff for you to merge, send back, or throw away.
      </p>

      <div class="kh-cmd" role="button" tabindex="0" @click="copy(INSTALL)" @keydown.enter="copy(INSTALL)">
        <code><span class="kh-dollar">$</span>{{ INSTALL }}</code>
        <span class="kh-copy">{{ copied === INSTALL ? "Copied" : "Copy" }}</span>
      </div>
      <p class="kh-then">
        then <code>cd your-repo &amp;&amp; kandy</code> <span class="kh-sep">·</span> macOS and Linux
        <span class="kh-sep">·</span> Node 22+
      </p>

      <div class="kh-actions">
        <a class="kh-btn kh-btn-primary" href="/guide/getting-started">Get started</a>
        <a class="kh-btn" href="/guide/how-it-works">How it works</a>
        <a class="kh-btn kh-btn-ghost" href="https://github.com/hiteshbandhu/kandy">GitHub</a>
      </div>
    </section>

    <figure class="kh-window">
      <img class="only-light" :src="shot('review').light" alt="The kandy board: four notes ready to review, one open beside its diff" />
      <img class="only-dark" :src="shot('review').dark" alt="The kandy board: four notes ready to review, one open beside its diff" />
    </figure>

    <p class="kh-agents">
      Runs the agents you already use —
      <span>Claude Code</span><span>Codex</span><span>Cursor</span><span>opencode</span><span>aider</span>
    </p>

    <!-- ── how it works ─────────────────────────────────────────────────── -->
    <section class="kh-section">
      <header class="kh-head">
        <p class="kh-eyebrow">How it works</p>
        <h2>Three steps. You're needed for two of them.</h2>
      </header>

      <div class="kh-steps">
        <article>
          <div class="kh-frame kh-frame-fit">
            <div class="kh-mini-term"><span class="kh-dollar">$</span> kandy "Add a dark theme that follows the system"</div>
            <span class="kh-or">or</span>
            <img class="only-light" :src="shot('composer').light" alt="The note composer, with Claude Code chosen" />
            <img class="only-dark" :src="shot('composer').dark" alt="The note composer, with Claude Code chosen" />
          </div>
          <p class="kh-n">1</p>
          <h3>Write a note</h3>
          <p>One line, in the terminal or the board. It becomes a job with its own branch, and an agent starts on it.</p>
        </article>

        <article>
          <div class="kh-frame">
            <img class="only-light" :src="shot('askpane').light" alt="A note waiting on you: the agent asks to run a command, with Allow once and Deny" />
            <img class="only-dark" :src="shot('askpane').dark" alt="A note waiting on you: the agent asks to run a command, with Allow once and Deny" />
          </div>
          <p class="kh-n">2</p>
          <h3>It works on its own</h3>
          <p>
            Each note runs in a fresh git worktree, so several agents can change one repo without colliding —
            your checkout is never touched. Anything outside the repo is put to you first.
          </p>
        </article>

        <article>
          <div class="kh-frame">
            <img class="only-light" :src="shot('diffpane').light" alt="A finished note: its diff, with Merge into main and Discard" />
            <img class="only-dark" :src="shot('diffpane').dark" alt="A finished note: its diff, with Merge into main and Discard" />
          </div>
          <p class="kh-n">3</p>
          <h3>Review, then land it</h3>
          <p>A diff per file. Merge it, open a pull request, or say what to change and it goes round again.</p>
        </article>
      </div>
    </section>

    <!-- ── features ─────────────────────────────────────────────────────── -->
    <section class="kh-section kh-features">
      <div class="kh-feature">
        <div class="kh-copytext">
          <p class="kh-eyebrow">Reviewing</p>
          <h2>Read what it did, not everything it tried.</h2>
          <p>
            Tool calls fold away. What's left is the agent's own account — what changed, what it
            checked, what it didn't — with the time, tokens and cost of the run beside it.
          </p>
          <p>
            Switch agents mid-note and the next one gets a <a href="/concepts/briefings">briefing</a>
            of what was done and decided, not a transcript to wade through.
          </p>
        </div>
        <div class="kh-stage kh-stage-bottom">
          <img class="only-light" :src="shot('streampane').light" alt="The agent's summary of a finished note, with its cost" />
          <img class="only-dark" :src="shot('streampane').dark" alt="The agent's summary of a finished note, with its cost" />
        </div>
      </div>

      <div class="kh-feature kh-feature-flip">
        <div class="kh-copytext">
          <p class="kh-eyebrow">The terminal</p>
          <h2>The same board, where you already are.</h2>
          <p>
            <code>kandy</code> opens the board in your terminal. Run, steer, read the diff, merge,
            answer an agent — all from the keyboard, against the same notes as the browser.
          </p>
          <p><a href="/guide/terminal">The terminal board →</a></p>
        </div>
        <div class="kh-frame kh-frame-term">
          <img src="/shots/site/terminal-note.webp" alt="kandy in a terminal: a finished note with the agent's summary, and keys to diff, merge or revise" />
        </div>
      </div>

      <div class="kh-feature">
        <div class="kh-copytext">
          <p class="kh-eyebrow">Teams</p>
          <h2>Share a board. Keep your machine.</h2>
          <p>
            A hub on your Tailscale network gives a team one board. Every note still runs on the
            laptop of the person it belongs to, with their agents and their logins — a hub runs
            nothing, and nothing runs on yours until you say yes.
          </p>
          <p><a href="/modes/">The three modes →</a></p>
        </div>
        <!-- A diagram, not a screenshot: what matters here is where work runs,
             and no single screen shows that. -->
        <div class="kh-diagram" role="img" aria-label="One hub holding the shared board, connected over the tailnet to three laptops that each run their own notes with their own agent">
          <div class="kh-node kh-hub">
            <p class="kh-node-t">Hub</p>
            <p class="kh-node-s">the shared board · runs nothing</p>
          </div>
          <p class="kh-wire-label">over your tailnet</p>
          <div class="kh-wires"><span /><span /><span /></div>
          <div class="kh-machines">
            <div v-for="m in MACHINES" :key="m.who" class="kh-node">
              <p class="kh-node-t">{{ m.who }}</p>
              <p class="kh-node-s">{{ m.notes }}</p>
              <p class="kh-node-agent"><span class="kh-agent-dot" :style="{ background: m.color }" />{{ m.agent }}</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ── modes ────────────────────────────────────────────────────────── -->
    <section class="kh-section">
      <header class="kh-head">
        <p class="kh-eyebrow">Three ways to use it</p>
        <h2>One program. Start alone; add people when you want to.</h2>
      </header>
      <div class="kh-modes">
        <a v-for="m in MODES" :key="m.name" class="kh-mode" :href="m.href">
          <h3>{{ m.name }}</h3>
          <code>{{ m.cmd }}</code>
          <p>{{ m.text }}</p>
        </a>
      </div>
    </section>

    <!-- ── proof ────────────────────────────────────────────────────────── -->
    <section class="kh-section">
      <header class="kh-head">
        <p class="kh-eyebrow">Built with itself</p>
        <h2>kandy's own board, building kandy.</h2>
      </header>
      <dl class="kh-stats">
        <div v-for="s in STATS" :key="s.label">
          <dt>{{ s.n }}</dt>
          <dd>{{ s.label }}</dd>
        </div>
      </dl>
      <p class="kh-stats-note">From <code>kandy stats</code>, {{ taken }}.</p>
    </section>

    <!-- ── start ────────────────────────────────────────────────────────── -->
    <section class="kh-section kh-end">
      <h2>Try it on a repo you don't mind.</h2>
      <div class="kh-cmd" role="button" tabindex="0" @click="copy(INSTALL)" @keydown.enter="copy(INSTALL)">
        <code><span class="kh-dollar">$</span>{{ INSTALL }}</code>
        <span class="kh-copy">{{ copied === INSTALL ? "Copied" : "Copy" }}</span>
      </div>
      <p class="kh-warn">
        <strong>Extremely experimental.</strong> It changes daily, and a board may need wiping. Your
        code isn't at risk — every note works on its own branch.
        <a href="/status">What that means →</a>
      </p>
    </section>
  </div>
</template>

<style scoped>
.kh { position: relative; z-index: 1; padding: 0 24px 96px; }

/* theme-matched screenshots */
.dark .only-light { display: none; }
html:not(.dark) .only-dark { display: none; }

/* ── hero ── */
.kh-hero { max-width: 760px; margin: 0 auto; padding: 88px 0 0; text-align: center; }

/* The app's own icon — the same one in the dock, the tab and the terminal. */
.kh-mark {
  display: block; width: 56px; height: 56px; margin: 0 auto 28px;
  border-radius: 13px;
  box-shadow: 0 12px 28px -12px rgb(34 20 40 / 0.45);
}

.kh-pill {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 5px 12px 5px 10px;
  border: 1px solid var(--vp-c-divider); border-radius: 999px;
  background: var(--vp-c-bg);
  font-size: 12.5px; color: var(--vp-c-text-2);
  text-decoration: none;
  transition: border-color 0.15s, color 0.15s;
}
.kh-pill:hover { border-color: var(--k-lemon); color: var(--vp-c-text-1); }
.kh-pill-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--k-lemon); }
.kh-arrow { color: var(--vp-c-text-3); }

.kh-title {
  margin: 28px 0 0;
  font-size: clamp(38px, 6.4vw, 68px);
  line-height: 1.05;
  letter-spacing: -0.035em;
  font-weight: 700;
  color: var(--vp-c-text-1);
}
.kh-title span { color: var(--vp-c-text-3); }

.kh-lead {
  max-width: 600px; margin: 24px auto 0;
  font-size: 17.5px; line-height: 1.6;
  color: var(--vp-c-text-2);
}

.kh-cmd {
  display: flex; align-items: stretch;
  max-width: 640px; margin: 36px auto 0;
  border: 1px solid var(--vp-c-divider); border-radius: 10px;
  background: var(--vp-c-bg-alt);
  text-align: left; cursor: pointer; overflow: hidden;
  transition: border-color 0.15s;
}
.kh-cmd:hover, .kh-cmd:focus-visible { border-color: var(--vp-c-brand-1); outline: none; }
.kh-cmd code {
  flex: 1; min-width: 0;
  padding: 13px 16px;
  font-size: 13px; background: none;
  white-space: nowrap; overflow-x: auto;
  scrollbar-width: none;
}
.kh-dollar { color: var(--vp-c-brand-1); margin-right: 10px; user-select: none; }
.kh-copy {
  flex: none; display: grid; place-items: center;
  padding: 0 16px;
  border-left: 1px solid var(--vp-c-divider);
  font-size: 12px; color: var(--vp-c-text-2);
}
.kh-cmd:hover .kh-copy { color: var(--vp-c-text-1); }

.kh-then { margin: 12px 0 0; font-size: 13px; color: var(--vp-c-text-3); }
.kh-then code { font-size: 12px; }
.kh-sep { margin: 0 6px; }

.kh-actions { display: flex; justify-content: center; flex-wrap: wrap; gap: 10px; margin: 32px 0 0; }
.kh-btn {
  padding: 9px 18px;
  border: 1px solid var(--vp-c-divider); border-radius: 8px;
  font-size: 14px; font-weight: 500;
  color: var(--vp-c-text-1); text-decoration: none;
  transition: border-color 0.15s, background 0.15s;
}
.kh-btn:hover { border-color: var(--vp-c-text-3); }
.kh-btn-primary { background: var(--vp-c-text-1); border-color: var(--vp-c-text-1); color: var(--vp-c-bg); }
.kh-btn-primary:hover { background: var(--vp-c-text-2); border-color: var(--vp-c-text-2); }
.kh-btn-ghost { border-color: transparent; color: var(--vp-c-text-2); }

/* The product, large. A thin border and one soft shadow: a window, not a slide. */
.kh-window {
  max-width: 1200px; margin: 72px auto 0;
  border: 1px solid var(--vp-c-divider); border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 40px 80px -40px rgb(34 20 40 / 0.35);
}
.kh-window img { display: block; width: 100%; height: auto; }

.kh-agents {
  margin: 28px auto 0; text-align: center;
  font-size: 13px; color: var(--vp-c-text-3);
}
.kh-agents span { margin-left: 14px; color: var(--vp-c-text-2); font-weight: 500; }

/* ── sections ── */
.kh-section { max-width: 1152px; margin: 128px auto 0; }
.kh-head { max-width: 640px; margin: 0 0 40px; }
.kh-eyebrow {
  margin: 0 0 12px;
  font-size: 12.5px; font-weight: 600; letter-spacing: 0.02em;
  color: var(--vp-c-brand-1);
}
.kh-section h2 {
  margin: 0; border: 0; padding: 0;
  font-size: clamp(26px, 3.2vw, 34px);
  line-height: 1.2; letter-spacing: -0.02em; font-weight: 650;
  color: var(--vp-c-text-1);
}
.kh-section h3 { margin: 0; font-size: 16px; font-weight: 600; color: var(--vp-c-text-1); }
.kh-section p { color: var(--vp-c-text-2); line-height: 1.65; }
.kh-section a:not(.kh-mode):not(.kh-btn) { color: var(--vp-c-brand-1); text-decoration: none; }
.kh-section a:not(.kh-mode):not(.kh-btn):hover { text-decoration: underline; }

/* Real UI, cropped to the part that matters. */
.kh-frame {
  position: relative;
  border: 1px solid var(--vp-c-divider); border-radius: 12px;
  background: var(--vp-c-bg-alt);
  overflow: hidden;
  aspect-ratio: 4 / 3.3;
}
.kh-frame img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top center; }
.kh-frame-fit {
  display: flex; flex-direction: column; justify-content: center; gap: 14px;
  padding: 20px;
}
.kh-frame-fit img { height: auto; object-fit: contain; border-radius: 10px; }
.kh-mini-term {
  padding: 12px 14px;
  border-radius: 10px;
  background: #16151d; color: #e8e6e3;
  font: 12px/1.4 var(--vp-font-family-mono);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.kh-or { text-align: center; font-size: 12px; color: var(--vp-c-text-3); }

.kh-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px; }
.kh-steps article p:not(.kh-n) { margin: 8px 0 0; font-size: 14.5px; }
.kh-n {
  margin: 22px 0 6px !important;
  font: 600 12px/1 var(--vp-font-family-mono);
  color: var(--vp-c-text-3) !important;
}

.kh-features { display: grid; gap: 120px; }
.kh-feature { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 64px; align-items: center; }
.kh-feature-flip { grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); }
.kh-feature-flip .kh-copytext { order: 2; }
.kh-copytext p { margin: 16px 0 0; font-size: 15.5px; }
/* A narrow pane shown at its own size on a soft panel, rather than stretched
   to fill one — stretched, its text is larger than the page's own. */
.kh-stage {
  position: relative; height: 480px;
  border: 1px solid var(--vp-c-divider); border-radius: 12px;
  background:
    radial-gradient(120% 80% at 50% 0%, var(--vp-c-brand-soft), transparent 70%),
    var(--vp-c-bg-alt);
  overflow: hidden;
}
.kh-stage img {
  position: absolute; left: 50%; transform: translateX(-50%);
  width: min(380px, 84%);
  border: 1px solid var(--vp-c-divider); border-radius: 12px;
  box-shadow: 0 24px 48px -24px rgb(34 20 40 / 0.35);
}
.kh-stage-bottom img { bottom: -150px; }
.kh-frame-term { aspect-ratio: auto; background: #16151d; border-color: #2c2a38; }
.kh-frame-term img { height: auto; object-fit: contain; }
.kh-diagram {
  display: flex; flex-direction: column; align-items: center;
  padding: 40px 28px;
  border: 1px solid var(--vp-c-divider); border-radius: 12px;
  background:
    radial-gradient(120% 80% at 50% 0%, var(--vp-c-brand-soft), transparent 70%),
    var(--vp-c-bg-alt);
}
.kh-node {
  padding: 14px 16px;
  border: 1px solid var(--vp-c-divider); border-radius: 10px;
  background: var(--vp-c-bg);
  text-align: left;
}
.kh-diagram .kh-node p { margin: 0; line-height: 1.4; }
.kh-node-t { font-size: 14px; font-weight: 600; color: var(--vp-c-text-1) !important; }
.kh-node-s { margin-top: 2px !important; font-size: 12.5px; color: var(--vp-c-text-2); }
.kh-node-agent { margin-top: 10px !important; font-size: 12.5px; color: var(--vp-c-text-1) !important; display: flex; align-items: center; gap: 6px; }
.kh-agent-dot { width: 7px; height: 7px; border-radius: 50%; }
.kh-hub { min-width: 240px; text-align: center; border-color: var(--vp-c-brand-1); }
.kh-wire-label { margin: 0 !important; padding: 10px 8px 0; font-size: 11.5px; color: var(--vp-c-text-3) !important; border-left: 1px dashed var(--vp-c-divider); }
/* One trunk down from the hub, a bar across, a drop to each machine. */
.kh-wires {
  position: relative; width: 67%; height: 22px;
  border-top: 1px dashed var(--vp-c-divider);
  display: flex; justify-content: space-between;
}
.kh-wires span { width: 0; height: 22px; border-left: 1px dashed var(--vp-c-divider); }
.kh-wires span:nth-child(2) { position: absolute; left: 50%; top: -22px; height: 44px; }
.kh-machines { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; width: 100%; }

.kh-modes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.kh-mode {
  display: block; padding: 24px;
  border: 1px solid var(--vp-c-divider); border-radius: 12px;
  text-decoration: none;
  transition: border-color 0.15s, transform 0.15s;
}
.kh-mode:hover { border-color: var(--vp-c-brand-1); }
.kh-mode code { display: inline-block; margin: 12px 0 0; font-size: 12.5px; }
.kh-mode p { margin: 12px 0 0; font-size: 14.5px; }

.kh-stats {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0; border-top: 1px solid var(--vp-c-divider);
}
.kh-stats > div { padding: 24px 0; }
.kh-stats dt { font-size: 32px; font-weight: 650; letter-spacing: -0.02em; color: var(--vp-c-text-1); }
.kh-stats dd { margin: 6px 0 0; font-size: 13px; color: var(--vp-c-text-2); }
.kh-stats-note { margin: 4px 0 0; font-size: 13px; }

.kh-end { max-width: 760px; text-align: center; }
.kh-end .kh-cmd { margin-top: 28px; }
.kh-warn { max-width: 560px; margin: 20px auto 0; font-size: 14px; }
.kh-warn strong { color: var(--vp-c-text-1); }

@media (max-width: 900px) {
  .kh-steps, .kh-modes { grid-template-columns: minmax(0, 1fr); }
  .kh-feature, .kh-feature-flip { grid-template-columns: minmax(0, 1fr); gap: 28px; }
  .kh-feature-flip .kh-copytext { order: 0; }
  .kh-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .kh-section { margin-top: 96px; }
  .kh-features { gap: 80px; }
}
@media (max-width: 640px) {
  .kh { padding: 0 16px 72px; }
  .kh-hero { padding-top: 56px; }
  .kh-window { margin-top: 48px; border-radius: 10px; }
  .kh-agents span { display: inline-block; margin: 4px 7px 0; }
  .kh-machines { grid-template-columns: minmax(0, 1fr); }
  .kh-wires { display: none; }
  .kh-wire-label { padding-bottom: 10px; }
  .kh-diagram { padding: 28px 16px; }
}
</style>
