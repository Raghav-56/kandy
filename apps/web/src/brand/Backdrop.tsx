import { useEffect, useRef } from "react"

/**
 * An ambient candy haze behind the whole app.
 *
 * Raw WebGL, two triangles and one fragment shader — no three.js, so this
 * costs a couple of kilobytes rather than three hundred. The last time kandy
 * had 3D it was the board itself, which cost legibility and bought nothing.
 * This is the opposite: depth you feel and never look at.
 *
 * It behaves: 30fps rather than 144, pauses when the tab is hidden, and
 * switches off entirely for prefers-reduced-motion. If WebGL is unavailable
 * the canvas simply stays transparent and the app looks as it always did.
 */
const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;

// Three slow blobs, in the palette. Kept dim enough that text over them never
// has to fight for contrast.
float blob(vec2 p, vec2 c, float r) {
  return smoothstep(r, 0.0, length(p - c));
}

void main() {
  vec2 p = gl_FragCoord.xy / uRes;
  // Correct for aspect so blobs stay round on wide screens.
  p.x *= uRes.x / uRes.y;
  float t = uTime * 0.06;

  vec2 a = vec2(0.25 + sin(t) * 0.20, 0.28 + cos(t * 0.8) * 0.14);
  vec2 b = vec2(1.05 + cos(t * 0.7) * 0.24, 0.72 + sin(t * 1.1) * 0.16);
  vec2 c = vec2(0.72 + sin(t * 1.3) * 0.30, 0.10 + cos(t * 0.6) * 0.12);

  vec3 berry = vec3(0.910, 0.498, 0.643);
  vec3 grape = vec3(0.655, 0.580, 0.941);
  vec3 lemon = vec3(0.910, 0.773, 0.416);

  vec3 col = berry * blob(p, a, 0.62) * 0.55
           + grape * blob(p, b, 0.70) * 0.50
           + lemon * blob(p, c, 0.55) * 0.28;

  // Fade toward the top, where the toolbar and its text live.
  float falloff = smoothstep(1.0, 0.15, p.y);
  gl_FragColor = vec4(col, 1.0) * 0.085 * falloff;
}`

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`

export function Backdrop() {
  const ref = useRef<HTMLCanvasElement>(null)

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

    const resize = () => {
      // Half resolution: it is a blur, nobody can tell, and it halves the fill.
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * 0.5
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
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      gl.getExtension("WEBGL_lose_context")?.loseContext()
    }
  }, [])

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  )
}
