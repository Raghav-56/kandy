<script setup lang="ts">
import { computed, ref } from "vue"
import stats from "../../data/stats.json"

/**
 * The hero, replacing VitePress's default one.
 *
 * Shaped after what the neighbours do, because they are right about the order:
 * one big claim, one short paragraph, one command you can copy, and then the
 * product itself — a real screenshot, bleeding off the fold so the page
 * continues rather than ends. Buttons that say "Getting started" are what a
 * site uses when it has nothing to show.
 *
 * The numbers are the part nobody else can copy: kandy's own board, building
 * kandy. They are real and they are read from `kandy stats`.
 */
const CMD = 'kandy "fix the flash when a note is selected"'
const copied = ref(false)

async function copy() {
  try {
    await navigator.clipboard.writeText(CMD)
    copied.value = true
    setTimeout(() => (copied.value = false), 1400)
  } catch {
    // Clipboard is permission-gated and can simply refuse. The command is
    // selectable text either way, so say nothing and let the user drag it.
  }
}

// Read from `kandy stats --json` by scripts/stats.mjs, not typed by hand —
// a number on a landing page is a claim, and this one is checkable.
const num = (n: number) => n.toLocaleString("en-US")
const STATS = computed(() => [
  { n: num(stats.landed), label: "notes landed" },
  { n: num(stats.runs), label: "agent runs" },
  { n: `+${num(stats.insertions)}`, label: "lines written" },
  { n: `${stats.estimated ? "≈" : ""}$${stats.usd.toFixed(2)}`, label: "total spend" },
])

const taken = computed(() =>
  new Date(stats.takenAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }),
)
</script>

<template>
  <section class="k-hero">
    <div class="k-hero-inner">
      <p class="k-eyebrow"><span class="k-rule" />A board for coding agents</p>

      <h1 class="k-title">
        Stop <em>babysitting</em><br />
        your coding agents
      </h1>

      <p class="k-sub">
        Twelve agents on one repository. Each job runs in its own git worktree, so
        they never collide — and comes back as a branch and a diff you approve.
      </p>

      <div class="k-cmd" @click="copy">
        <code><span class="k-dollar">$</span> {{ CMD }}</code>
        <button class="k-copy" type="button" :aria-label="copied ? 'Copied' : 'Copy command'">
          {{ copied ? "COPIED" : "COPY" }}
        </button>
      </div>

      <p class="k-meta">
        macOS · Linux · Node 22+ —
        <a href="/guide/getting-started">getting started</a> ·
        <a href="/guide/cli">the CLI</a>
      </p>

      <dl class="k-stats">
        <div v-for="s in STATS" :key="s.label">
          <dt>{{ s.n }}</dt>
          <dd>{{ s.label }}</dd>
        </div>
      </dl>
      <p class="k-stats-note">
        kandy's own board, building kandy — <code>kandy stats</code>, {{ taken }}
      </p>
    </div>

    <!-- Cropped deliberately: the board continues past the fold, which is the
         one thing a static image can say about a list that is never finished. -->
    <div class="k-shot">
      <img src="/shots/board.png" alt="The kandy board: a note blocked on a decision, one ready to review, three agents working, and nine landed" />
    </div>
  </section>
</template>

<style scoped>
.k-hero { position: relative; z-index: 1; }
.k-hero-inner { max-width: 1152px; margin: 0 auto; padding: 88px 24px 0; }

.k-eyebrow {
  display: flex; align-items: center; gap: 12px;
  margin: 0 0 22px;
  font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--vp-c-text-2);
}
.k-rule { display: block; width: 40px; height: 1px; background: var(--vp-c-brand-1); opacity: 0.7; }

.k-title {
  margin: 0;
  font-size: clamp(40px, 7vw, 76px);
  line-height: 1.04;
  letter-spacing: -0.035em;
  font-weight: 800;
}
.k-title em { font-style: normal; color: var(--vp-c-brand-1); }

.k-sub {
  max-width: 34rem;
  margin: 24px 0 0;
  font-size: 17px; line-height: 1.6;
  color: var(--vp-c-text-2);
}

/* The command is the call to action. A box you can copy says "this is a tool"
   in a way a pill-shaped button never does. */
.k-cmd {
  display: flex; align-items: stretch; justify-content: space-between;
  max-width: 34rem; margin: 32px 0 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-alt);
  cursor: pointer;
  overflow: hidden;
}
.k-cmd code {
  padding: 13px 16px;
  font-size: 13.5px;
  background: none;
  white-space: nowrap; overflow-x: auto;
}
.k-dollar { color: var(--vp-c-brand-1); }
.k-copy {
  flex: none;
  padding: 0 16px;
  border-left: 1px solid var(--vp-c-divider);
  font-size: 11px; letter-spacing: 0.1em;
  color: var(--vp-c-text-2);
  cursor: pointer;
}
.k-cmd:hover .k-copy { color: var(--vp-c-text-1); }

.k-meta { margin: 14px 0 0; font-size: 13px; color: var(--vp-c-text-3, var(--vp-c-text-2)); }
.k-meta a { color: var(--vp-c-brand-1); text-decoration: none; }
.k-meta a:hover { text-decoration: underline; }

/* Proof, not decoration: these are this repository's own numbers. */
.k-stats {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  margin: 56px 0 0;
  border-top: 1px solid var(--vp-c-divider);
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-divider);
}
.k-stats > div { padding: 20px 4px; background: var(--vp-c-bg); }
.k-stats dt { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
.k-stats dd {
  margin: 4px 0 0;
  font-size: 11.5px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--vp-c-text-2);
}
.k-stats-note { margin: 10px 0 0; font-size: 12px; color: var(--vp-c-text-2); }
.k-stats-note code { font-size: 0.92em; }

.k-shot { max-width: 1280px; margin: 56px auto 0; padding: 0 24px; }
.k-shot img {
  display: block; width: 100%;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px 12px 0 0;
  border-bottom: 0;
  /* Cropped at the fold rather than fading out: a hard edge reads as a window,
     a gradient reads as a slide transition. */
  max-height: 560px; object-fit: cover; object-position: top left;
}

@media (max-width: 760px) {
  .k-hero-inner { padding-top: 56px; }
  .k-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .k-shot img { max-height: 300px; }
}
</style>
