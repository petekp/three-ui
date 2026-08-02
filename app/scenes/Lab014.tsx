// Lab 014 — the page has a third dimension.
//
// A real, ordinary, scrollable, selectable HTML page: a two-column board of
// task cards over a few hundred words of prose. Press a card and it PEELS
// OFF the page — the same component, still live, now a rigid plate with mass
// and inertia hanging off your pointer, casting a real shadow back down onto
// the page it came from. Let go and it flies into whichever slot you were
// over, the document reflows around it for real, and it lies back down as
// ordinary DOM.
//
// The three things that make it work, all of them small:
//
// 1. THE WORLD UNIT IS A CSS PIXEL. `PixelPerfect` sets the camera distance
//    to (viewportHeight/2)/tan(fov/2), so the plane z = 0 is the viewport,
//    exactly. A card's `getBoundingClientRect()` is therefore already a
//    world pose, and there is not one conversion function anywhere in this
//    file. Lifting toward the camera is then honest perspective: the card
//    gets bigger because it is closer, and the LOD ladder re-rasterizes it
//    sharper on the way up because it really is covering more pixels.
//
// 2. NOTHING IS EVER MOVED. The page card does not go anywhere at handoff —
//    it turns `visibility: hidden`, which keeps its box, so the layout does
//    not twitch and the slot is already the right size to be a drop target.
//    The airborne copy is a second React root rendering the SAME component
//    from the SAME state. That is why there is no flash to hide: the page
//    copy stays visible until the Surface has actually painted, and for the
//    two frames where both exist they are pixel-identical and in the same
//    place.
//
// 3. THE CANVAS IS ONLY SOLID WHERE THERE IS MATTER. The overlay is
//    `pointer-events: none` at rest — a canvas with nothing in it must not be
//    able to eat a click, a text selection or a scroll — and is switched to
//    `auto` for exactly as long as the pointer is over an airborne card.
//    Same rule as decisions #20, one level up: hit-test first, then decide
//    whether you are there at all.
//
// And the loop closes: the physics writes `--l14-near` onto the slot it is
// aimed at, so a rigid-body simulation running in WebGL is restyling real
// DOM through ordinary CSS, at the same time as that DOM is being rasterized
// into the material of the thing doing the simulating.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SurfaceApp, useSurfaceTexture } from 'three-ui'
import '../lab014.css'
import {
  atRest,
  corners,
  makePlate,
  stepFree,
  stepHeld,
  Swing,
  type Plate,
} from './lab014Plate'

// ── the data ─────────────────────────────────────────────────────────────

interface Card {
  id: string
  tag: string
  title: string
  body: string
  note: string
  done: boolean
}

type ColId = 'queue' | 'today'
const COLS: { id: ColId; name: string }[] = [
  { id: 'queue', name: 'Queue' },
  { id: 'today', name: 'Today' },
]

const SEED: Card[] = [
  {
    id: 'c1',
    tag: 'shader',
    title: 'Scissor each glass pass',
    body: 'Every SDF pass is full-screen. Clip it to the panel’s screen AABB.',
    note: '',
    done: false,
  },
  {
    id: 'c2',
    tag: 'a11y',
    title: 'Announcer kit',
    body: 'Live-region plumbing for scene-level focus moves.',
    note: 'after the demo',
    done: false,
  },
  {
    id: 'c3',
    tag: 'perf',
    title: 'Measure the upload ceiling again',
    body: '64–96 concurrent painting sources at 120 Hz — is that still true?',
    note: '',
    done: true,
  },
  {
    id: 'c4',
    tag: 'docs',
    title: 'Write down the depth-order bug',
    body: 'Distance to the eye is not depth. Any centred scene hides it.',
    note: 'decisions #43',
    done: false,
  },
  {
    id: 'c5',
    tag: 'spike',
    title: 'Pick this card up',
    body: 'It is still a DOM element. Type in the field while it is in the air.',
    note: '',
    done: false,
  },
]

const START: Record<ColId, string[]> = {
  queue: ['c1', 'c2', 'c4'],
  today: ['c3', 'c5'],
}

// ── flight ───────────────────────────────────────────────────────────────

/** How far off the page the hand lifts a card, px. */
const LIFT_Z = 96
/** Seconds to reach it. */
const LIFT_T = 0.22

interface Flight {
  id: string
  w: number
  h: number
  /** Where on the card the fingers are, body-local px, +y up. */
  hold: THREE.Vector3
  plate: Plate
  /**
   * `held` — the hand is on it. `float` — it was tapped rather than dragged,
   * and hangs where it was left. `home` — it is flying back into its slot.
   *
   * `float` is the state the whole lab is actually about. A card is only
   * interesting as matter for as long as it is off the page, and a card you
   * have to keep the mouse button down on is a card you cannot click into. So
   * a tap parks it in mid-air, still solid, still a DOM subtree: you can put
   * the caret in its note field and type while it is casting a shadow on the
   * paragraph below it. Tap it again and it goes home.
   */
  mode: 'held' | 'float' | 'home'
  /** Where a floating card hangs: the grab point's world position when let go. */
  anchor: THREE.Vector3
  /**
   * …and the page's scroll offset at that instant. The anchor is in world
   * coordinates, which are pinned to the VIEWPORT, but the card is hanging
   * over a particular paragraph — and it is casting a shadow on it. Let the
   * page scroll under a stationary card and the shadow slides off the thing
   * that was supposed to be under it, which reads instantly as fake. So the
   * anchor rides the scroll: it is a page position wearing world clothes.
   */
  anchorScroll: number
  /** Start of the current press — how a tap is told from a drag. */
  downAt: number
  downX: number
  downY: number
  /** Has this card already been parked once? A second tap sends it home. */
  floated: boolean
  /** Live pointer, client px. */
  px: number
  py: number
  swing: Swing
  /** 0 → 1 as the card leaves the page. */
  lift: number
  /** r3f frames since mount — the page copy hides once the quad has painted. */
  frames: number
  /** Set by the driver, read by React: the card has landed. */
  done: boolean
}

// ── the card, rendered identically on the page and in the air ─────────────

interface CardBodyProps {
  card: Card
  onChange: (patch: Partial<Card>) => void
  /** Only the page copy starts drags; the airborne one is grabbed in 3D. */
  onGrab?: (e: React.PointerEvent<HTMLDivElement>) => void
  hidden?: boolean
}

function CardBody({ card, onChange, onGrab, hidden }: CardBodyProps) {
  return (
    <div
      className="l14-card"
      data-done={card.done}
      data-card={card.id}
      onPointerDown={onGrab}
      style={hidden ? { visibility: 'hidden' } : undefined}
    >
      <div className="l14-row">
        <h3>{card.title}</h3>
        <span className="l14-tag">{card.tag}</span>
      </div>
      <p>{card.body}</p>
      <input
        className="l14-note"
        data-nodrag
        placeholder="note…"
        value={card.note}
        onChange={(e) => onChange({ note: e.target.value })}
      />
      <label className="l14-check" data-nodrag>
        <input
          type="checkbox"
          checked={card.done}
          onChange={(e) => onChange({ done: e.target.checked })}
        />
        done
      </label>
    </div>
  )
}

// ── the airborne copy's material ─────────────────────────────────────────
//
// `material="none"` hands the material slot to us (decisions #33) so the card
// can be UNLIT — a lit standard material would shade the texture and the
// handoff would stop being invisible the moment a light moved. What it does
// add is a gloss band keyed to the plate's own normal: the only cue that the
// thing is tilted, since an unlit quad has no other way to say so.

const CARD_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  void main() {
    vUv = uv;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const CARD_FRAG = /* glsl */ `
  uniform sampler2D tMap;
  uniform float uGloss;
  varying vec2 vUv;
  varying vec3 vN;
  void main() {
    vec4 c = texture2D(tMap, vUv);
    // A broad highlight from up and to the left, riding the surface normal.
    // At rest the normal is +z, so the term is constant — and it has to be
    // constant ZERO, because a card lying in its slot must be exactly its own
    // pixels, not a shade of them. The bias is therefore the value the band
    // takes at rest, which is L.z raised to the same power: hand-writing it
    // as a literal is how this shipped 4.5% dark, a flat neutral tint that
    // reads as "the texture is slightly transparent" and sends you looking at
    // the blend mode.
    vec3 L = normalize(vec3(-0.45, 0.62, 0.65));
    float s = max(dot(vN, L), 0.0);
    float band = pow(s, 6.0) - pow(L.z, 6.0);
    c.rgb += uGloss * band;
    gl_FragColor = c;
  }
`

function CardMaterial({ gloss = 0.5 }: { gloss?: number }) {
  const texture = useSurfaceTexture()
  const uniforms = useMemo(
    () => ({ tMap: { value: null as THREE.Texture | null }, uGloss: { value: gloss } }),
    [gloss],
  )
  uniforms.tMap.value = texture ?? null
  return (
    <shaderMaterial
      key={texture?.uuid ?? 'none'}
      uniforms={uniforms}
      vertexShader={CARD_VERT}
      fragmentShader={CARD_FRAG}
      transparent
      toneMapped={false}
      side={THREE.DoubleSide}
    />
  )
}

// ── the shadow the card throws back onto the page ────────────────────────
//
// Not a decal and not a blob: the plate's four corners projected onto z = 0
// along the light direction, so a tilted card throws a genuinely sheared
// quadrilateral. The softness and the weight are functions of how far off the
// page it is, which is the only reason a shadow reads as height at all.
//
// It darkens the PAGE, not the scene — the canvas composites over the
// document with alpha, so a translucent black quad drawn over the prose is
// a shadow falling on real text.

const SHADOW_FRAG = /* glsl */ `
  uniform vec2 uQuadHalf;
  uniform vec2 uCardHalf;
  uniform float uRadius;
  uniform float uBlur;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv * 2.0 - 1.0) * uQuadHalf;
    vec2 d = abs(p) - uCardHalf + uRadius;
    float sd = min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - uRadius;
    float a = 1.0 - smoothstep(-uBlur, uBlur, sd);
    if (a <= 0.001) discard;
    gl_FragColor = vec4(0.055, 0.05, 0.035, a * uAlpha);
  }
`

const SHADOW_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const LIGHT = new THREE.Vector3(-0.30, -0.46, -1).normalize()

// ── the driver ───────────────────────────────────────────────────────────

interface DriverProps {
  flight: React.RefObject<Flight | null>
  slotRect: (id: string) => DOMRect | null
  /** The page's scroll offset — a floating card's anchor rides it. */
  scrollTop: () => number
  onLanded: () => void
  /**
   * The card's pose is carried by a GROUP wrapping the Surface, not by the
   * Surface's own mesh. `Surface` spreads the caller's mesh props BEFORE
   * installing its own `ref`, so a `ref` passed down through `SurfaceApp`
   * would overwrite the one Surface uses internally to drive its texture.
   * A wrapper group costs a matrix and cannot collide with anything.
   */
  cardRef: React.RefObject<THREE.Group | null>
  shadowRef: React.RefObject<THREE.Mesh | null>
  onPainted: () => void
}

const FLAT = new THREE.Quaternion()
const _target = new THREE.Vector3()
const _corners: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
]
const _centroid = new THREE.Vector3()

function Driver({ flight, slotRect, scrollTop, onLanded, cardRef, shadowRef, onPainted }: DriverProps) {
  const size = useThree((s) => s.size)

  useFrame((_, rawDt) => {
    const f = flight.current
    const group = cardRef.current
    if (!f || !group) return
    // A tab that was backgrounded hands back a dt measured in seconds; a
    // stiff spring integrated over one of those explodes. Clamp, don't trust.
    const dt = Math.min(rawDt, 1 / 30)

    f.frames++
    if (f.frames === 3) onPainted()

    const vw = size.width
    const vh = size.height

    if (f.mode === 'held') {
      f.lift = Math.min(1, f.lift + dt / LIFT_T)
      // easeOutCubic — a hand accelerates the card away from the page and
      // then stops; a linear rise reads as a lift dialog, not a lift.
      const e = 1 - Math.pow(1 - f.lift, 3)
      _target.set(f.px - vw / 2, vh / 2 - f.py, LIFT_Z * e)
      stepHeld(f.plate, dt, _target, f.hold, FLAT)
    } else if (f.mode === 'float') {
      // Identical machinery, with the hand replaced by a fixed point in the
      // air. The card settles flat and stays there — and because it is still
      // the held solver, grabbing it again is a change of one target vector.
      // Scrolling the page down moves content up the screen, and world y is
      // up, so the anchor moves the same way by the same amount.
      _target.copy(f.anchor)
      _target.y += scrollTop() - f.anchorScroll
      stepHeld(f.plate, dt, _target, f.hold, FLAT)
    } else {
      const r = slotRect(f.id)
      if (r) _target.set(r.left + r.width / 2 - vw / 2, vh / 2 - (r.top + r.height / 2), 0)
      else _target.set(f.plate.p.x, f.plate.p.y, 0)
      stepFree(f.plate, dt, _target, FLAT)
      if (!f.done && atRest(f.plate, _target)) {
        f.done = true
        onLanded()
      }
    }

    group.position.copy(f.plate.p)
    group.quaternion.copy(f.plate.q)

    // ── the shadow, from the plate's own corners ──
    const sh = shadowRef.current
    if (!sh) return
    corners(f.plate, f.w, f.h, _corners)
    _centroid.set(0, 0, 0)
    for (const c of _corners) _centroid.add(c)
    _centroid.multiplyScalar(0.25)

    const height = Math.max(_centroid.z, 0)
    const blur = 5 + 0.34 * height
    const alpha = 0.3 / (1 + height / 210)
    const margin = blur * 2.2

    // Where the centroid's own shadow lands — the point the footprint is
    // expanded away from.
    const ct = -_centroid.z / LIGHT.z
    const cx = _centroid.x + LIGHT.x * ct
    const cy = _centroid.y + LIGHT.y * ct

    const pos = sh.geometry.getAttribute('position') as THREE.BufferAttribute
    // PlaneGeometry's vertex order is TL, TR, BL, BR; `corners` walks the
    // rectangle TL, TR, BR, BL. Cross the two wrong and the quad comes out
    // as a bow tie, which is a very memorable way to find out.
    const order = [0, 1, 3, 2]
    for (let i = 0; i < 4; i++) {
      const c = _corners[order[i]]
      const t = -c.z / LIGHT.z
      const x = c.x + LIGHT.x * t
      const y = c.y + LIGHT.y * t
      // Push the footprint out past the silhouette so the blur has somewhere
      // to live; the SDF inside puts the real edge back.
      const dx = x - cx
      const dy = y - cy
      const len = Math.hypot(dx, dy) || 1
      pos.setXYZ(i, x + (dx / len) * margin, y + (dy / len) * margin, 0.5)
    }
    pos.needsUpdate = true
    sh.geometry.computeBoundingSphere()

    const mat = sh.material as THREE.ShaderMaterial
    ;(mat.uniforms.uQuadHalf.value as THREE.Vector2).set(f.w / 2 + margin, f.h / 2 + margin)
    ;(mat.uniforms.uCardHalf.value as THREE.Vector2).set(f.w / 2, f.h / 2)
    mat.uniforms.uRadius.value = 14
    mat.uniforms.uBlur.value = blur
    mat.uniforms.uAlpha.value = alpha
  })

  return null
}

// ── the airborne card ────────────────────────────────────────────────────

interface FlyingProps {
  card: Card
  flight: React.RefObject<Flight | null>
  onChange: (patch: Partial<Card>) => void
  onRegrab: (localX: number, localY: number, clientX: number, clientY: number) => void
  slotRect: (id: string) => DOMRect | null
  scrollTop: () => number
  onLanded: () => void
  onPainted: () => void
}

function Flying({ card, flight, onChange, onRegrab, slotRect, scrollTop, onLanded, onPainted }: FlyingProps) {
  const f = flight.current!
  const cardRef = useRef<THREE.Group>(null)
  const shadowRef = useRef<THREE.Mesh>(null)
  const grabbed = useRef<(() => void) | null>(null)

  // Re-grabbing an airborne card cannot go through an r3f handler: `Surface`
  // installs its own `onPointerDown` AFTER spreading the caller's mesh props,
  // so ours would simply be discarded. It comes through the DOM instead —
  // which is better anyway, because then the `[data-nodrag]` test that
  // protects the note field is the same one the page copy uses, and the hit
  // has already been resolved against the real subtree rather than against a
  // rectangle. The host is `position: fixed` at page (0, 0) (decisions #16),
  // so an offset within its rect IS the body-local point.
  const onHost = useCallback(
    (el: HTMLElement | null) => {
      grabbed.current?.()
      grabbed.current = null
      if (!el) return
      const down = (ev: PointerEvent) => {
        if ((ev.target as Element).closest('[data-nodrag]')) return
        const r = el.getBoundingClientRect()
        onRegrab(
          ev.clientX - r.left - f.w / 2,
          -(ev.clientY - r.top - f.h / 2),
          ev.clientX,
          ev.clientY,
        )
      }
      el.addEventListener('pointerdown', down)
      grabbed.current = () => el.removeEventListener('pointerdown', down)
    },
    [onRegrab, f.w, f.h],
  )
  useEffect(() => () => grabbed.current?.(), [])

  const shadowUniforms = useMemo(
    () => ({
      uQuadHalf: { value: new THREE.Vector2(1, 1) },
      uCardHalf: { value: new THREE.Vector2(1, 1) },
      uRadius: { value: 14 },
      uBlur: { value: 8 },
      uAlpha: { value: 0.28 },
    }),
    [],
  )

  return (
    <>
      <Driver
        flight={flight}
        slotRect={slotRect}
        scrollTop={scrollTop}
        onLanded={onLanded}
        cardRef={cardRef}
        shadowRef={shadowRef}
        onPainted={onPainted}
      />

      <mesh ref={shadowRef} renderOrder={0} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial
          uniforms={shadowUniforms}
          vertexShader={SHADOW_VERT}
          fragmentShader={SHADOW_FRAG}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <group ref={cardRef}>
        <SurfaceApp
          label={`lab014-${card.id}`}
          width={f.w}
          height={f.h}
          resolution={[1, 3]}
          material="none"
          renderOrder={1}
          frustumCulled={false}
          userData={{ matter: true }}
          onHost={onHost}
          content={<CardBody card={card} onChange={onChange} />}
        >
          <planeGeometry args={[f.w, f.h]} />
          <CardMaterial />
        </SurfaceApp>
      </group>
    </>
  )
}

// ── camera calibration ───────────────────────────────────────────────────

const FOV = 42

function PixelPerfect() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  useLayoutEffect(() => {
    // The whole lab rests on this one line: put the camera exactly far
    // enough back that the frustum is the viewport at z = 0. Everything
    // downstream — rects as poses, texels as pixels, "1 CSS px" as a world
    // unit — is a consequence of it and nothing else has to know.
    camera.fov = FOV
    camera.position.set(0, 0, size.height / 2 / Math.tan((FOV * Math.PI) / 360))
    camera.near = 1
    camera.far = camera.position.z * 3
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }, [camera, size.width, size.height])
  return null
}

/**
 * The canvas is `pointer-events: none` until the pointer is genuinely over a
 * piece of matter, then `auto`, then none again. Without it an overlay eats
 * the page: no text selection, no links, no scrolling.
 */
function SolidWhereMatterIs({ active }: { active: boolean }) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const size = useThree((s) => s.size)

  useEffect(() => {
    const el = gl.domElement
    if (!active) {
      el.style.pointerEvents = 'none'
      return
    }
    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const test = (e: PointerEvent) => {
      ndc.set((e.clientX / size.width) * 2 - 1, -(e.clientY / size.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      const hit = ray.intersectObjects(scene.children, true).some((h) => h.object.userData.matter)
      el.style.pointerEvents = hit ? 'auto' : 'none'
    }
    window.addEventListener('pointermove', test, true)
    return () => {
      window.removeEventListener('pointermove', test, true)
      el.style.pointerEvents = 'none'
    }
  }, [gl, camera, scene, size.width, size.height, active])

  return null
}

// ── FLIP, so the reflow is something you can watch ───────────────────────

function captureRects(root: HTMLElement) {
  const out = new Map<Element, DOMRect>()
  root.querySelectorAll('.l14-slot').forEach((el) => out.set(el, el.getBoundingClientRect()))
  return out
}

/**
 * Play the difference. These are page elements, not Surface content, so
 * transforms are perfectly ordinary here — the compositor rule this project
 * lives under only ever applied to a subtree being rasterized.
 */
function playFlip(root: HTMLElement, before: Map<Element, DOMRect>) {
  root.querySelectorAll('.l14-slot').forEach((el) => {
    const b = before.get(el)
    if (!b) return
    const a = el.getBoundingClientRect()
    const dx = b.left - a.left
    const dy = b.top - a.top
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
    el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: 230, easing: 'cubic-bezier(.22,.61,.36,1)' },
    )
  })
}

// ── the lab ──────────────────────────────────────────────────────────────

export function Lab014App({ chips }: { chips?: React.ReactNode }) {
  const [cards, setCards] = useState<Record<string, Card>>(
    () => Object.fromEntries(SEED.map((c) => [c.id, c])) as Record<string, Card>,
  )
  const [board, setBoard] = useState<Record<ColId, string[]>>(() => ({ ...START }))
  const [flyingId, setFlyingId] = useState<string | null>(null)
  const [painted, setPainted] = useState(false)

  const flight = useRef<Flight | null>(null)
  const slots = useRef(new Map<string, HTMLLIElement>())
  const boardEl = useRef<HTMLDivElement>(null)
  const lastMove = useRef(0)

  const scroller = useRef<HTMLDivElement>(null)

  const slotRect = useCallback((id: string) => {
    const el = slots.current.get(id)
    return el ? el.getBoundingClientRect() : null
  }, [])

  const scrollTop = useCallback(() => scroller.current?.scrollTop ?? 0, [])

  const patch = useCallback((id: string, p: Partial<Card>) => {
    setCards((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }))
  }, [])

  // Where would a drop at (x, y) land? The gap the card would leave is
  // already in the list — it is the card's own slot, still holding its full
  // height because the page copy is only hidden, not removed. So this is a
  // plain "which slot is the pointer nearest the top half of".
  const dropTarget = useCallback(
    (x: number, y: number, id: string): { col: ColId; index: number } | null => {
      for (const { id: col } of COLS) {
        const list = board[col]
        const ul = boardEl.current?.querySelector(`[data-col="${col}"] ul`)
        if (!ul) continue
        const r = ul.getBoundingClientRect()
        if (x < r.left - 24 || x > r.right + 24) continue
        let index = list.length
        for (let i = 0; i < list.length; i++) {
          const sr = slotRect(list[i])
          if (sr && y < sr.top + sr.height / 2) {
            index = i
            break
          }
        }
        // Removing the card from its own column shifts everything after it.
        const from = list.indexOf(id)
        if (from >= 0 && index > from) index--
        return { col, index }
      }
      return null
    },
    [board, slotRect],
  )

  const moveTo = useCallback(
    (col: ColId, index: number, id: string) => {
      setBoard((prev) => {
        const cur = (Object.keys(prev) as ColId[]).find((c) => prev[c].includes(id))!
        if (cur === col && prev[cur].indexOf(id) === index) return prev
        const next = { queue: [...prev.queue], today: [...prev.today] }
        next[cur].splice(next[cur].indexOf(id), 1)
        next[col].splice(index, 0, id)
        return next
      })
    },
    [],
  )

  // FLIP: snapshot before every commit that can move a slot, play after.
  const pending = useRef<Map<Element, DOMRect> | null>(null)
  const snapshot = useCallback(() => {
    if (boardEl.current) pending.current = captureRects(boardEl.current)
  }, [])
  useLayoutEffect(() => {
    if (pending.current && boardEl.current) playFlip(boardEl.current, pending.current)
    pending.current = null
  }, [board])

  // ── the gesture ──
  const beginDrag = useCallback(
    (id: string, e: React.PointerEvent<HTMLDivElement>) => {
      if ((e.target as Element).closest('[data-nodrag]')) return
      if (flight.current) return
      const el = (e.currentTarget as HTMLElement).getBoundingClientRect()
      e.preventDefault()

      const plate = makePlate(el.width, el.height)
      plate.p.set(
        el.left + el.width / 2 - window.innerWidth / 2,
        window.innerHeight / 2 - (el.top + el.height / 2),
        0,
      )
      const swing = new Swing()
      swing.reset(e.clientX, e.clientY)

      flight.current = {
        id,
        w: el.width,
        h: el.height,
        hold: new THREE.Vector3(
          e.clientX - (el.left + el.width / 2),
          el.top + el.height / 2 - e.clientY,
          0,
        ),
        plate,
        mode: 'held',
        anchor: new THREE.Vector3(),
        anchorScroll: 0,
        downAt: performance.now(),
        downX: e.clientX,
        downY: e.clientY,
        floated: false,
        px: e.clientX,
        py: e.clientY,
        swing,
        lift: 0,
        frames: 0,
        done: false,
      }
      lastMove.current = performance.now()
      setPainted(false)
      setFlyingId(id)
    },
    [],
  )

  const regrab = useCallback((localX: number, localY: number, cx: number, cy: number) => {
    const f = flight.current
    if (!f) return
    f.hold.set(localX, localY, 0)
    f.mode = 'held'
    f.lift = Math.max(f.lift, 0.35)
    f.done = false
    f.px = cx
    f.py = cy
    f.swing.reset(cx, cy)
    f.downAt = performance.now()
    f.downX = cx
    f.downY = cy
    lastMove.current = performance.now()
  }, [])

  // Registered once and always, NOT gated on `flyingId`. An effect keyed on
  // that state does not run until React has committed the render the
  // `pointerdown` scheduled — and a quick tap's `pointerup` arrives before
  // that, so the listener that was supposed to hear the release did not exist
  // yet and the card stayed glued to a pointer whose button was already up.
  // Every handler here reads `flight.current`, which is set synchronously, so
  // there is nothing to gate: with no flight they all return on the first line.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const f = flight.current
      if (!f) return
      const now = performance.now()
      const dt = (now - lastMove.current) / 1000
      lastMove.current = now
      f.px = e.clientX
      f.py = e.clientY
      f.swing.push(e.clientX, e.clientY, dt)
      if (f.mode !== 'held') return

      const t = dropTarget(e.clientX, e.clientY, f.id)
      if (t) {
        snapshot()
        moveTo(t.col, t.index, f.id)
      }
    }

    const onUp = () => {
      const f = flight.current
      if (!f || f.mode !== 'held') return

      // A tap is a gesture, a drag is a different gesture, and the only thing
      // that separates them is that a tap did not go anywhere. 6 px is the
      // usual slop for "the hand did not mean to move"; 320 ms is long enough
      // that a slow, deliberate pick-up still counts.
      const moved = Math.hypot(f.px - f.downX, f.py - f.downY)
      const tap = moved < 6 && performance.now() - f.downAt < 320
      if (tap && !f.floated) {
        f.floated = true
        f.mode = 'float'
        // Hang it exactly where the fingers were, not where the centre is —
        // otherwise a card tapped by its corner jumps half its width sideways
        // at the moment of release.
        f.anchor.copy(f.hold).applyQuaternion(f.plate.q).add(f.plate.p)
        f.anchorScroll = scrollTop()
        f.swing.reset(f.px, f.py)
        return
      }

      f.mode = 'home'
      // Hand the swing over as real velocity. Screen y is down, world y is
      // up — the sign is the difference between a card that follows your
      // throw and one that jumps backwards out of your hand.
      f.plate.v.x += f.swing.v.x
      f.plate.v.y -= f.swing.v.y
    }

    // Escape always puts it back. A floating card is a modeless state and
    // modeless states need an exit that does not require aim.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const f = flight.current
      if (!f || f.mode === 'home') return
      f.mode = 'home'
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [dropTarget, moveTo, snapshot, scrollTop])

  const onLanded = useCallback(() => {
    flight.current = null
    setFlyingId(null)
    setPainted(false)
    document.querySelectorAll<HTMLElement>('.l14-slot').forEach((el) => {
      el.style.removeProperty('--l14-near')
    })
  }, [])

  // The loop closing: the physics writes a CSS custom property onto the slot
  // it is aimed at, every frame, and ordinary CSS does the rest.
  useEffect(() => {
    if (!flyingId) return
    let raf = 0
    const tick = () => {
      const f = flight.current
      if (f) {
        const r = slotRect(f.id)
        const el = slots.current.get(f.id)
        if (r && el) {
          const d = Math.hypot(
            f.plate.p.x - (r.left + r.width / 2 - window.innerWidth / 2),
            f.plate.p.y - (window.innerHeight / 2 - (r.top + r.height / 2)),
            f.plate.p.z,
          )
          el.style.setProperty('--l14-near', String(Math.max(0, 1 - d / 260).toFixed(3)))
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [flyingId, slotRect])

  const flyingCard = flyingId ? cards[flyingId] : null

  return (
    <div className="l14" ref={scroller}>
      <div className="l14-inner">
        <h1>Board</h1>
        <p className="l14-lede">
          An ordinary page. Select this text, scroll it, tab through it — then
          press a card and pull.
        </p>

        <div className="l14-board" ref={boardEl}>
          {COLS.map((col) => (
            <section className="l14-col" data-col={col.id} key={col.id}>
              <h2>{col.name}</h2>
              <ul>
                {board[col.id].map((id) => (
                  <li
                    className="l14-slot"
                    key={id}
                    data-empty={flyingId === id && painted}
                    ref={(el) => {
                      if (el) slots.current.set(id, el)
                      else slots.current.delete(id)
                    }}
                  >
                    <CardBody
                      card={cards[id]}
                      onChange={(p) => patch(id, p)}
                      onGrab={(e) => beginDrag(id, e)}
                      hidden={flyingId === id && painted}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <article className="l14-prose">
          <h2>What is actually happening</h2>
          <p>
            The cards above are DOM. So is this paragraph. The difference is
            that a card, while you are holding it, is also a rigid body: a thin
            plate with the inertia of its own dimensions, hanging off your
            pointer by whatever point you closed your fingers on. Grab one by a
            corner and it swings, because <code>r × F</code> is a torque and a
            torque needs an orientation to act on.
          </p>
          <p>
            Nothing is moved at the handoff. The card you pressed turns{' '}
            <code>visibility: hidden</code> — which keeps its box, so the page
            does not twitch — and a second React root renders the same
            component into a parked canvas that becomes the material of a quad.
            Both copies exist for two frames and they are the same pixels in
            the same place, so there is no moment to catch.
          </p>
          <h2>Why the seam is invisible</h2>
          <p>
            The camera sits exactly <code>(height/2)/tan(fov/2)</code> back, so
            the plane <code>z = 0</code> is the viewport and one world unit is
            one CSS pixel. A card&rsquo;s <code>getBoundingClientRect()</code>{' '}
            is already a pose. Lifting it toward you is honest perspective —
            it grows because it is nearer, and the texture is re-rasterized at
            a finer tier on the way up because it genuinely covers more pixels
            than it did on the page.
          </p>
          <p>
            The shadow is the plate&rsquo;s four corners projected onto{' '}
            <code>z = 0</code> along the light, so a tilted card throws a
            sheared quadrilateral rather than a blob. It falls on this text
            because the canvas composites over the document with alpha: there
            is no compositing trick and no blend mode, just a translucent black
            quadrilateral drawn where the light does not reach.
          </p>
          <h2>And the loop closes</h2>
          <p>
            While a card is in the air, the simulation writes{' '}
            <code>--l14-near</code> onto the slot it is aimed at. Real CSS
            reads it and tints the well. So the DOM is being rasterized into
            the material of the object that is, at the same time, restyling the
            DOM — which is either a feedback loop or a single interaction
            layer, depending on how generous you are feeling.
          </p>
        </article>
      </div>

      <Canvas
        className="l14-overlay"
        // `position`, `inset` and `pointer-events` all have to be INLINE. r3f
        // writes `position: relative` AND `pointer-events: auto` onto its own
        // wrapper div as inline styles, and an inline declaration outranks any
        // class — so the stylesheet lost silently, twice. First the overlay was
        // laid out as an ordinary block after the article, a full viewport
        // below the fold (the scene was complete and correct the whole time; it
        // was simply somewhere else). Then, once it was in the right place, the
        // wrapper sat over the entire page swallowing every pointerdown, so no
        // card could be grabbed at all — a full-viewport invisible div is a
        // very quiet way to break a page.
        //
        // `SolidWhereMatterIs` toggles the CANVAS, one level down. A child may
        // re-enable `pointer-events` under a `none` parent, which is exactly
        // the arrangement we want: the wrapper is permanently transparent to
        // the pointer, and the canvas inside it is solid only while the ray
        // says it is over matter.
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}
        gl={{ alpha: true, antialias: true }}
        // An overlay stretched across somebody's document does not get to burn
        // a GPU frame every 8 ms for the privilege of being empty. There is a
        // card in flight or there is nothing to draw, and the difference is
        // this prop. (Same instinct as the upload-on-paint contract one layer
        // down: idle costs nothing, and "idle" is the normal case.)
        frameloop={flyingId ? 'always' : 'demand'}
        dpr={[1, 2]}
        camera={{ fov: FOV, position: [0, 0, 1000] }}
        onCreated={(state) => {
          state.gl.setClearAlpha(0)
          ;(window as unknown as { __r3f: unknown }).__r3f = state
        }}
      >
        <PixelPerfect />
        <SolidWhereMatterIs active={!!flyingId} />
        {flyingCard && flight.current && (
          <Flying
            key={flyingCard.id}
            card={flyingCard}
            flight={flight}
            onChange={(p) => patch(flyingCard.id, p)}
            onRegrab={regrab}
            slotRect={slotRect}
            scrollTop={scrollTop}
            onLanded={onLanded}
            onPainted={() => setPainted(true)}
          />
        )}
      </Canvas>

      <div className="l14-hud">
        {chips}
        <span>
          press a card and pull · throw it into the other column · tap one to
          leave it hanging, then type in its note · esc puts it back
        </span>
      </div>
    </div>
  )
}
