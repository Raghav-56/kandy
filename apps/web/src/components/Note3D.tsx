import { useRef, useState } from "react"
import { useFrame, type ThreeEvent } from "@react-three/fiber"
import { Text } from "@react-three/drei"
import * as THREE from "three"
import type { Note } from "@kandy/core"
import { CARD, SURFACES } from "./status"
import { FONT_BODY, FONT_DISPLAY } from "./fonts"

type Props = {
  note: Note
  /** Where it belongs when nothing is being dragged. */
  target: [number, number, number]
  selected: boolean
  onSelect: () => void
  onDragStart: () => void
  onDrag: (x: number, y: number) => void
  onDragEnd: () => void
  dragging: boolean
  dragPos: [number, number] | null
}

export function Note3D({
  note,
  target,
  selected,
  onSelect,
  onDragStart,
  onDrag,
  onDragEnd,
  dragging,
  dragPos,
}: Props) {
  const group = useRef<THREE.Group>(null)
  const sweep = useRef<THREE.Mesh>(null)
  const [hover, setHover] = useState(false)
  // A pointer that moved is a drag; one that didn't is a click. Without this
  // every drop also opens the inspector.
  const moved = useRef(false)

  const s = SURFACES[note.status]

  useFrame((state, dt) => {
    const g = group.current
    if (!g) return

    const t = state.clock.elapsedTime
    const k = 1 - Math.pow(0.0015, dt) // frame-rate independent easing

    const [tx, ty, tz] = target
    const wantX = dragging && dragPos ? dragPos[0] : tx
    const wantY = dragging && dragPos ? dragPos[1] : ty
    const lift = dragging ? 1.4 : selected ? 0.9 : hover ? 0.28 : 0
    const wantZ = tz + s.depth + lift

    g.position.x += (wantX - g.position.x) * k
    g.position.y += (wantY - g.position.y) * k
    g.position.z += (wantZ - g.position.z) * k

    const wantScale = s.scale * (dragging ? 1.06 : selected ? 1.05 : hover ? 1.02 : 1)
    // Running work breathes. It is the quietest possible way to say "alive".
    const breathe = note.status === "running" ? 1 + Math.sin(t * 2.2) * 0.006 : 1
    const sc = wantScale * breathe
    g.scale.x += (sc - g.scale.x) * k
    g.scale.y = g.scale.x
    g.scale.z = g.scale.x

    // Blocked work nudges, rarely. Constant motion is noise; a twitch every
    // few seconds is a person clearing their throat.
    const cycle = t % 4
    const twitch = note.status === "blocked" && cycle > 3.7 ? Math.sin(cycle * 90) * 0.05 : 0
    const restTilt = dragging ? -0.12 : selected ? 0 : -0.035
    g.rotation.z += (twitch - g.rotation.z) * k
    g.rotation.x += (restTilt - g.rotation.x) * k

    // A hairline crossing the foot of the card: progress without a spinner.
    if (sweep.current) {
      const on = note.status === "running"
      sweep.current.visible = on
      if (on) sweep.current.position.x = -CARD.w / 2 + (((t * 0.45) % 1) * CARD.w)
    }
  })

  const stop = (e: ThreeEvent<PointerEvent>) => e.stopPropagation()

  return (
    <group
      ref={group}
      position={target}
      onPointerOver={(e) => {
        stop(e)
        setHover(true)
        document.body.style.cursor = "pointer"
      }}
      onPointerOut={() => {
        setHover(false)
        document.body.style.cursor = "auto"
      }}
      onPointerDown={(e) => {
        stop(e)
        moved.current = false
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
        onDragStart()
      }}
      onPointerMove={(e) => {
        if (!dragging) return
        stop(e)
        moved.current = true
        onDrag(e.point.x, e.point.y)
      }}
      onPointerUp={(e) => {
        stop(e)
        if (moved.current) onDragEnd()
        else {
          onDragEnd()
          onSelect()
        }
      }}
    >
      {/* The card. Matte, real thickness, lit achromatically — the shading is
          the grayscale layering the system already uses, not decoration. */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[CARD.w, CARD.h, CARD.d]} />
        <meshStandardMaterial color={s.face} roughness={0.92} metalness={0} />
      </mesh>

      {/* Inverted cards get a hairline so they don't dissolve into the void. */}
      {(note.status === "blocked" || note.status === "failed") && (
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(CARD.w, CARD.h, CARD.d)]} />
          <lineBasicMaterial color={note.status === "blocked" ? "#ffffff" : "#454545"} />
        </lineSegments>
      )}

      {/* Review carries a solid band along the top edge: work awaiting a verdict. */}
      {note.status === "review" && (
        <mesh position={[0, CARD.h / 2 - 0.055, CARD.d / 2 + 0.001]}>
          <planeGeometry args={[CARD.w, 0.11]} />
          <meshBasicMaterial color="#000000" />
        </mesh>
      )}

      <mesh ref={sweep} position={[0, -CARD.h / 2 + 0.05, CARD.d / 2 + 0.001]} visible={false}>
        <planeGeometry args={[0.34, 0.018]} />
        <meshBasicMaterial color="#000000" />
      </mesh>

      <Text
        font={FONT_DISPLAY}
        fontSize={0.112}
        lineHeight={1.18}
        letterSpacing={-0.015}
        maxWidth={CARD.w - 0.34}
        anchorX="left"
        anchorY="top"
        color={s.ink}
        position={[-CARD.w / 2 + 0.17, CARD.h / 2 - 0.19, CARD.d / 2 + 0.002]}
        clipRect={[0, -0.72, CARD.w - 0.3, 0]}
      >
        {note.title}
      </Text>

      <Text
        font={FONT_DISPLAY}
        fontSize={0.058}
        letterSpacing={0.04}
        anchorX="left"
        anchorY="bottom"
        color={s.dim}
        position={[-CARD.w / 2 + 0.17, -CARD.h / 2 + 0.13, CARD.d / 2 + 0.002]}
      >
        {note.status.toUpperCase()}
      </Text>

      {note.agent && (
        <Text
          font={FONT_BODY}
          fontSize={0.058}
          anchorX="right"
          anchorY="bottom"
          color={s.dim}
          position={[CARD.w / 2 - 0.17, -CARD.h / 2 + 0.13, CARD.d / 2 + 0.002]}
        >
          {note.agent}
        </Text>
      )}
    </group>
  )
}
