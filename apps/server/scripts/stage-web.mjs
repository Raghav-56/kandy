import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Copy the built board (and the kandy skill) into the server's own dist, so they ship.
 *
 * `files: ["dist"]` is what npm packs, and the board lived in a sibling
 * workspace outside it — the tarball carried 153 files and none of them was
 * the UI. An installed kandy started, printed its banner, and served nothing.
 *
 * Staged rather than symlinked because npm follows neither: a symlink into
 * ../../web/dist packs as a broken link.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
const pkg = path.resolve(HERE, "..")
const root = path.resolve(HERE, "../../..")
const from = path.resolve(HERE, "../../web/dist")
const to = path.resolve(HERE, "../dist/web")

/*
 * npm renders whatever README sits beside package.json, and packs a LICENSE
 * the same way. Both live at the repo root, so `files` listed two things that
 * were never there — the tarball shipped neither. Copied rather than moved:
 * the root is still where they belong.
 */
for (const name of ["README.md", "LICENSE"]) {
  const src = path.join(root, name)
  if (existsSync(src)) cpSync(src, path.join(pkg, name))
}

/*
 * `kandy skill` copies the kandy skill to ~/.claude/skills. It lived only at
 * the repo root, which no install has — so the command failed everywhere but
 * a source checkout. It ships in dist/skill, next to the code that reads it.
 */
const skill = path.join(root, ".claude/skills/kandy/SKILL.md")
if (existsSync(skill)) {
  mkdirSync(path.join(pkg, "dist/skill"), { recursive: true })
  cpSync(skill, path.join(pkg, "dist/skill/SKILL.md"))
} else {
  console.log("  stage-web: no kandy skill to stage — kandy skill won't work in this build")
}

if (!existsSync(path.join(from, "index.html"))) {
  // Not a failure. `turbo run build` builds the web app too, but someone
  // running just this package's build should get a working daemon that says
  // "board not built" rather than a build that refuses to finish.
  console.log("  stage-web: no web build to stage (run `pnpm build` at the root)")
  process.exit(0)
}

rmSync(to, { recursive: true, force: true })
cpSync(from, to, { recursive: true })
console.log(`  stage-web: board staged into ${path.relative(process.cwd(), to)}`)
