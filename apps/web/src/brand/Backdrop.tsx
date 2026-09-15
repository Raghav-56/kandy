import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

/** Tracks the resolved theme, so the canvas can pick a blend mode. */
function useIsLight(): boolean {
  const [light, setLight] = useState(
    () => document.documentElement.dataset["theme"] === "light",
  )
  useEffect(() => {
    const el = document.documentElement
    const obs = new MutationObserver(() => setLight(el.dataset["theme"] === "light"))
    obs.observe(el, { attributes: true, attributeFilter: ["data-theme"] })
    return () => obs.disconnect()
  }, [])
  return light
}

/**
 * An ambient candy haze behind the whole app.
 *
 * Raw WebGL, two triangles and one fragment shader — no three.js, so this
 * costs a couple of kilobytes rather than three hundred. The last time kandy
 * had 3D it was the board itself, which cost legibility and bought nothing.
 * This is the opposite: depth you feel and never look at.
 *
 * Domain-warped fbm rather than three moving circles: the earlier version was
 * visibly three blobs on a timer. Grain is added because a wide, very flat
 * gradient bands on an 8-bit display, and the banding is the thing people
 * actually notice.
 *
 * It behaves: 30fps rather than 144, pauses when the tab is hidden, and
 * switches off entirely for prefers-reduced-motion. If WebGL is unavailable
 * the canvas simply stays transparent and the app looks as it always did.
 */
const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uLight;

// Value noise, three octaves. Enough structure that the field reads as depth
// rather than as three circles fading in and out of each other.
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

/*
 * An interleaved-gradient threshold — the dither.
 *
 * Its error spectrum sits high enough that the eye reads it as texture rather
 * than as a pattern, which is what a blue-noise texture buys without shipping
 * one. Deliberately not fed uTime: a threshold that moves every frame makes
 * the whole field crawl, and this is meant to sit still behind text.
 */
float dither(vec2 f) {
  return fract(52.9829189 * fract(dot(f, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec2 p = gl_FragCoord.xy / uRes;
  p.x *= uRes.x / uRes.y;
  float t = uTime * 0.035;

  // Domain warp: the field is sampled through a slowly drifting offset, which
  // is what stops it looking like blurred blobs on a timer.
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

  // Heaviest in the lower corners, gone where the toolbar and its text live.
  float edge = smoothstep(0.95, 0.05, p.y) * (0.55 + 0.45 * abs(p.x / (uRes.x / uRes.y) - 0.5) * 2.0);

  // Grain still, but a third of what it was: the dither below does most of
  // what this was there for, and the two together read as dirt.
  float grain = (hash(gl_FragCoord.xy * 0.7 + uTime) - 0.5) * 0.006;

  // Multiply needs more signal than screen to be visible at all. Named lit
  // rather than c because a float c already exists above, and a redefinition
  // is a shader that never compiles — silently, since only the link is checked.
  vec3 lit = (col + grain) * mix(0.315, 0.30, uLight) * edge;

  /*
   * Dither, then quantise — in that order, and never the other way.
   *
   * Eighteen steps over a field this faint is about five visible levels, so
   * this is a posterised look rather than a band fix: the haze reads as a few
   * flat plateaus with a fine stipple along every boundary, instead of a
   * smooth wash. The threshold is offset to ±half a step so it pushes a value
   * across the nearest boundary rather than brightening everything.
   */
  const float STEPS = 18.0;
  float th = (dither(gl_FragCoord.xy) - 0.5) / STEPS;
  gl_FragColor = vec4(max(floor((lit + th) * STEPS + 0.5) / STEPS, 0.0), 1.0);
}`

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`

export function Backdrop() {
  const ref = useRef<HTMLCanvasElement>(null)
  const light = useIsLight()

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return

    const gl = canvas.getContext("webgl", { antialias: false, alpha: true, depth: false })
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
      /*
       * One shader pixel per CSS pixel, exactly.
       *
       * This used to render at two-thirds of device resolution and let the
       * browser scale it up, which is free for a smooth gradient and fatal for
       * a dither: the pattern is a pixel-level thing, and resampling it turns
       * a clean stipple into moiré. At dpr 1 the backing store matches the
       * element, nothing is resampled, and on a retina display each shader
       * pixel lands on a tidy 2×2 — which is the grain size this was tuned at.
       */
      const dpr = 1
      canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr))
      canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr))
      gl.viewport(0, 0, canvas.width, canvas.height)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let raf = 0
    let last = 0
    const start = performance.now()
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      // 30fps is plenty for something moving this slowly, and halves the cost.
      if (now - last < 33) return
      last = now
      if (document.hidden) return
      gl.uniform2f(uRes, canvas.width, canvas.height)
      gl.uniform1f(uTime, (now - start) / 1000)
      // Light mode needs it fainter: the same value over paper reads as a stain.
      gl.uniform1f(uLight, document.documentElement.dataset["theme"] === "light" ? 1 : 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      gl.getExtension("WEBGL_lose_context")?.loseContext()
    }
  }, [])

  // Blend rather than paint. Additive colour over a white page is invisible —
  // which is why light mode looked like it had no backdrop at all. `screen`
  // lightens a dark desk, `multiply` tints a pale one; the same shader then
  // reads correctly in both.
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={cn(
        "pointer-events-none fixed inset-0 -z-10 h-full w-full",
        light ? "mix-blend-multiply" : "mix-blend-screen",
      )}
    />
  )
}
