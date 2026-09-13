<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue"

/**
 * The app's own backdrop, in the docs.
 *
 * The same domain-warped fbm shader kandy renders behind the board, so the
 * site and the product share an atmosphere rather than each inventing one.
 * Two triangles and one fragment shader — no three.js.
 *
 * It behaves: 30fps, pauses when the tab is hidden, off entirely under
 * prefers-reduced-motion, and simply absent if WebGL is unavailable.
 */
const canvas = ref<HTMLCanvasElement | null>(null)
let stop: (() => void) | null = null

const VERT = `attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uLight;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  return 0.55 * noise(p) + 0.30 * noise(p * 2.03) + 0.15 * noise(p * 4.11);
}

void main() {
  vec2 p = gl_FragCoord.xy / uRes;
  p.x *= uRes.x / uRes.y;
  float t = uTime * 0.035;

  vec2 warp = vec2(fbm(p * 1.6 + t), fbm(p * 1.6 - t + 4.7));
  vec2 q = p + (warp - 0.5) * 0.65;

  float a = fbm(q * 1.15 + vec2(t * 0.7, -t * 0.4));
  float b = fbm(q * 1.35 + vec2(-t * 0.5, t * 0.9) + 11.3);
  float c = fbm(q * 0.95 + vec2(t * 0.3, t * 0.6) + 23.1);

  vec3 berry = vec3(0.910, 0.498, 0.643);
  vec3 grape = vec3(0.655, 0.580, 0.941);
  vec3 mint  = vec3(0.455, 0.839, 0.675);

  vec3 col = berry * smoothstep(0.42, 0.95, a)
           + grape * smoothstep(0.40, 0.92, b)
           + mint  * smoothstep(0.52, 0.98, c) * 0.6;

  // Strongest at the top, where the hero is, and gone by the time the prose
  // starts — text never has to fight it.
  float fade = smoothstep(0.0, 0.85, p.y);
  float grain = (hash(gl_FragCoord.xy * 0.7 + uTime) - 0.5) * 0.012;

  float strength = mix(0.13, 0.28, uLight);
  gl_FragColor = vec4(col + grain, 1.0) * strength * fade;
}`

onMounted(() => {
  const el = canvas.value
  if (!el) return
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return

  const gl = el.getContext("webgl", { antialias: false, alpha: true, depth: false })
  if (!gl) return

  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    return sh
  }
  const program = gl.createProgram()!
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT))
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return
  gl.useProgram(program)

  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const aPos = gl.getAttribLocation(program, "aPos")
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

  const uRes = gl.getUniformLocation(program, "uRes")
  const uTime = gl.getUniformLocation(program, "uTime")
  const uLight = gl.getUniformLocation(program, "uLight")

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * 0.66
    el.width = Math.max(1, Math.floor(el.clientWidth * dpr))
    el.height = Math.max(1, Math.floor(el.clientHeight * dpr))
    gl.viewport(0, 0, el.width, el.height)
  }
  resize()
  const ro = new ResizeObserver(resize)
  ro.observe(el)

  let raf = 0
  let last = 0
  const start = performance.now()
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame)
    if (now - last < 33) return
    last = now
    if (document.hidden) return
    gl.uniform2f(uRes, el.width, el.height)
    gl.uniform1f(uTime, (now - start) / 1000)
    gl.uniform1f(uLight, document.documentElement.classList.contains("dark") ? 0 : 1)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
  raf = requestAnimationFrame(frame)

  stop = () => {
    cancelAnimationFrame(raf)
    ro.disconnect()
    gl.getExtension("WEBGL_lose_context")?.loseContext()
  }
})

onBeforeUnmount(() => stop?.())
</script>

<template>
  <canvas ref="canvas" class="kandy-backdrop" aria-hidden="true" />
</template>

<style scoped>
/* Screen lightens a dark page; multiply tints a pale one. Adding colour to
   white does nothing, which is what made it invisible in light mode. */
.kandy-backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 620px;
  pointer-events: none;
  z-index: 0;
  mix-blend-mode: multiply;
  /* On white, multiply at full strength reads as a grey smudge rather than as
     atmosphere. It should be felt, not seen — and it must never compete with
     the headline sitting on top of it. */
  opacity: 0.22;
  mask-image: linear-gradient(to bottom, #000 35%, transparent 92%);
}
.dark .kandy-backdrop { mix-blend-mode: screen; opacity: 0.8; }
</style>
