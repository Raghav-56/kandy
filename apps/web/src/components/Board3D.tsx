import { useMemo, useRef, useState } from "react"
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber"
import { Text } from "@react-three/drei"
import * as THREE from "three"
import { notesIn, type BoardView, type Note } from "@kandy/core"
import { CARD, LANE_GAP, ROW_GAP } from "./status"
import { FONT_DISPLAY } from "./fonts"
import { Note3D } from "./Note3D"

type Props = {
  view: BoardView
  selectedId: string | null
  onSelect: (noteId: string | null) => void
  onMove: (noteId: string, columnId: string, afterId: string | null) => void
  onCompose: (columnId: string) => void
}

export function Board3D(props: Props) {
  return (
    <Canvas
      camera={{ fov: 34, position: [0, 0, 11], near: 0.1, far: 100 }}
      dpr={[1, 2]}
      gl={{ antialias: true }}
      onPointerMissed={() => props.onSelect(null)}
    >
      <color attach="background" args={["#000000"]} />

      {/* Achromatic lighting only. The shading reads as the system's grayscale
          layering; anything warmer would smuggle colour back in. */}
      <ambientLight intensity={1.1} />
      <directionalLight position={[-4, 6, 8]} intensity={2.1} color="#ffffff" />
      <directionalLight position={[6, -2, 4]} intensity={0.5} color="#ffffff" />

      <Scene {...props} />
    </Canvas>
  )
}

function Scene({ view, selectedId, onSelect, onMove, onCompose }: Props) {
  const root = useRef<THREE.Group>(null)
  const { size } = useThree()
  const [drag, setDrag] = useState<{ noteId: string; x: number; y: number } | null>(null)

  const lanes = useMemo(
    () => view.columns.map((c) => ({ column: c, notes: notesIn(view, c.id) })),
    [view],
  )

  // Centre the board and scale it down as lanes multiply, so five columns fit
  // a laptop without the user having to go looking for them.
  const spanX = (lanes.length - 1) * LANE_GAP
  const tallest = Math.max(1, ...lanes.map((l) => l.notes.length))
  const fit = Math.min(1, 10.4 / (spanX + CARD.w + 1.2), 6.2 / (tallest * ROW_GAP))

  useFrame((state, dt) => {
    const g = root.current
    if (!g) return
    // Parallax, not orbit. Enough to make the depth legible; never enough to
    // let someone get lost behind the board.
    const k = 1 - Math.pow(0.02, dt)
    const px = (state.pointer.x || 0) * 0.09
    const py = (state.pointer.y || 0) * 0.05
    g.rotation.y += (px - g.rotation.y) * k
    g.rotation.x += (-py - g.rotation.x) * k
    g.scale.setScalar(fit)
  })

  const laneX = (i: number) => i * LANE_GAP - spanX / 2
  const noteY = (i: number) => 2.3 - i * ROW_GAP

  /** Which lane is a dragged card currently over. */
  function laneAt(x: number): number {
    return Math.max(0, Math.min(lanes.length - 1, Math.round((x + spanX / 2) / LANE_GAP)))
  }

  function drop(note: Note) {
    if (!drag) return
    const lane = lanes[laneAt(drag.x)]
    setDrag(null)
    if (!lane) return

    // Land it where it visually sits, not always at the end — a board where
    // dropping silently reorders is a board you stop trusting.
    const others = lane.notes.filter((n) => n.id !== note.id)
    const slot = Math.round((2.3 - drag.y) / ROW_GAP)
    const afterId = slot <= 0 ? null : (others[Math.min(slot, others.length) - 1]?.id ?? null)

    const samePlace = note.columnId === lane.column.id && afterId === null && others.length === 0
    if (!samePlace) onMove(note.id, lane.column.id, afterId)
  }

  return (
    <group ref={root}>
      {/* An invisible catcher so a drag keeps tracking when the pointer leaves
          the card it started on. */}
      <mesh
        visible={false}
        position={[0, 0, 0]}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          if (drag) setDrag({ ...drag, x: e.point.x, y: e.point.y })
        }}
      >
        <planeGeometry args={[60, 60]} />
      </mesh>

      {lanes.map((lane, li) => {
        const x = laneX(li)
        const active = drag !== null && laneAt(drag.x) === li
        return (
          <group key={lane.column.id} position={[x, 0, 0]}>
            <Text
              font={FONT_DISPLAY}
              fontSize={0.17}
              letterSpacing={0.02}
              anchorX="left"
              anchorY="bottom"
              color={active ? "#ffffff" : "#575757"}
              position={[-CARD.w / 2, 3.16, 0]}
            >
              {lane.column.name.toUpperCase()}
            </Text>
            <Text
              font={FONT_DISPLAY}
              fontSize={0.17}
              anchorX="right"
              anchorY="bottom"
              color={active ? "#ffffff" : "#454545"}
              position={[CARD.w / 2, 3.16, 0]}
            >
              {String(lane.notes.length)}
            </Text>
            {/* The system's separator: a hairline, nothing more. */}
            <mesh position={[0, 3.06, 0]}>
              <planeGeometry args={[CARD.w, active ? 0.012 : 0.006]} />
              <meshBasicMaterial color={active ? "#ffffff" : "#454545"} />
            </mesh>

            <AddCard y={noteY(lane.notes.length)} onClick={() => onCompose(lane.column.id)} />
          </group>
        )
      })}

      {lanes.flatMap((lane, li) =>
        lane.notes.map((note, ni) => (
          <Note3D
            key={note.id}
            note={note}
            target={[laneX(li), noteY(ni), 0]}
            selected={selectedId === note.id}
            dragging={drag?.noteId === note.id}
            dragPos={drag?.noteId === note.id ? [drag.x, drag.y] : null}
            onSelect={() => onSelect(note.id)}
            onDragStart={() =>
              setDrag({ noteId: note.id, x: laneX(li), y: noteY(ni) })
            }
            onDrag={(x, y) => setDrag({ noteId: note.id, x, y })}
            onDragEnd={() => drop(note)}
          />
        )),
      )}

      {/* Keep the canvas honest about its own size on resize. */}
      <primitive object={new THREE.Object3D()} visible={false} key={size.width} />
    </group>
  )
}

/** The affordance for a new note: an empty outline where a card would go. */
function AddCard({ y, onClick }: { y: number; onClick: () => void }) {
  const [hover, setHover] = useState(false)
  const geo = useMemo(() => new THREE.PlaneGeometry(CARD.w, CARD.h), [])

  return (
    <group
      position={[0, y, -0.2]}
      onPointerOver={(e) => {
        e.stopPropagation()
        setHover(true)
        document.body.style.cursor = "pointer"
      }}
      onPointerOut={() => {
        setHover(false)
        document.body.style.cursor = "auto"
      }}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <mesh visible={false}>
        <planeGeometry args={[CARD.w, CARD.h]} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[geo]} />
        <lineBasicMaterial color={hover ? "#ffffff" : "#1c1c1c"} />
      </lineSegments>
      <Text
        font={FONT_DISPLAY}
        fontSize={0.09}
        letterSpacing={0.06}
        anchorX="center"
        anchorY="middle"
        color={hover ? "#ffffff" : "#454545"}
      >
        + NOTE
      </Text>
    </group>
  )
}
