<script setup lang="ts">
import Mark from "./Mark.vue"

/**
 * The hero shows the product rather than describing it.
 *
 * A terminal beside the board it produces — the two surfaces kandy actually
 * has, side by side, with real output rather than a mock. The default hero was
 * a wall of words and an empty right-hand column.
 */
const notes = [
  { agent: "claude", title: "Fix the flash when a note is selected", tone: "lemon", state: "running", detail: "Edit  apps/web/src/app/NoteRow.tsx" },
  { agent: "codex", title: "Add a --json flag to kandy serve", tone: "mint", state: "review", plus: 41, minus: 6, files: 2 },
  { agent: "claude", title: "Test the fractional indexing", tone: "mint", state: "review", plus: 105, minus: 1, files: 2 },
  { agent: "codex", title: "Report token usage on the board", tone: "muted", state: "done", plus: 13, minus: 0, files: 1 },
]
</script>

<template>
  <div class="hero-board">
    <div class="pane terminal">
      <div class="chrome"><span /><span /><span /></div>
      <pre><code><span class="p">~/your-repo</span> <span class="c">$</span> kandy <span class="s">"fix the flash when a note is selected"</span>
  <span class="ok">✓</span> Fix the flash when a note is selected  <span class="d">running with claude</span>
    <span class="d">http://127.0.0.1:4477</span>

<span class="p">~/your-repo</span> <span class="c">$</span> kandy ls
  <span class="lemon">● running</span>       Fix the flash when a note is selected
  <span class="mint">● review</span>        Add a --json flag to kandy serve
                 <span class="d">codex · +41 -6 · 88k tok</span></code></pre>
    </div>

    <div class="pane board">
      <div class="board-head">
        <Mark :size="15" />
        <span class="board-name">kandy</span>
        <span class="spend">≈$5.35</span>
      </div>
      <div
        v-for="n in notes"
        :key="n.title"
        class="note"
        :class="{ settled: n.state === 'done' }"
      >
        <span class="dot" :class="n.tone" />
        <div class="note-body">
          <div class="title">{{ n.title }}</div>
          <div class="meta">
            <template v-if="n.detail">
              <span class="lemon">{{ n.detail }}</span>
            </template>
            <template v-else>
              <span class="mint">+{{ n.plus }}</span>
              <span class="berry">−{{ n.minus }}</span>
              <span class="d">{{ n.files }} files</span>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hero-board {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  max-width: 1152px;
  margin: 0 auto;
  padding: 0 24px 64px;
}
@media (min-width: 960px) {
  .hero-board { grid-template-columns: 1.05fr 1fr; gap: 20px; }
}

.pane {
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
  overflow: hidden;
}

.chrome { display: flex; gap: 6px; padding: 11px 13px; border-bottom: 1px solid var(--vp-c-divider); }
.chrome span { width: 9px; height: 9px; border-radius: 999px; background: var(--vp-c-divider); }

.terminal pre { margin: 0; padding: 16px; overflow-x: auto; background: none; }
.terminal code {
  font-size: 12px;
  line-height: 1.75;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-2);
}

.p { color: #7db4f0; }
.c { color: #a794f0; }
.s { color: #e8c56a; }
.ok { color: #74d6ac; }
.d { color: var(--vp-c-text-3); }
.lemon { color: #a8802a; }
.mint { color: #3d9c73; }
.berry { color: #c2527c; }
.dark .lemon { color: #e8c56a; }
.dark .mint { color: #74d6ac; }
.dark .berry { color: #e87fa4; }

.board-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--vp-c-divider);
}
.board-name { font-size: 13px; font-weight: 600; letter-spacing: -0.02em; }
.spend { margin-left: auto; font-size: 11.5px; color: var(--vp-c-text-3); font-variant-numeric: tabular-nums; }

.note { display: flex; gap: 10px; padding: 11px 14px; border-bottom: 1px solid var(--vp-c-divider); }
.note:last-child { border-bottom: 0; }
.note.settled { opacity: 0.55; }
.dot { width: 7px; height: 7px; margin-top: 5px; border-radius: 999px; flex-shrink: 0; }
.dot.lemon { background: #e8c56a; }
.dot.mint { background: #74d6ac; }
.dot.muted { background: var(--vp-c-divider); }

.note-body { min-width: 0; }
.title { font-size: 13px; font-weight: 500; line-height: 1.35; }
.meta {
  margin-top: 5px;
  display: flex;
  gap: 7px;
  font-size: 11px;
  font-family: var(--vp-font-family-mono);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
