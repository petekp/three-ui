import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useFrame, useThree } from '@react-three/fiber'
import type { Group, Mesh, PerspectiveCamera } from 'three'
import { toast } from 'sonner'
import { FocusGroup, Surface } from '../index'
import { useAnimationConductor } from '../primitives/useAnimationConductor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'

// Lab 009 — shadcn as matter. The components below are byte-verbatim from
// the shadcn registry (new-york-v4); nothing about them knows it is being
// rasterized into a WebGL material. The three seams of the port live
// elsewhere: the hover/active variant twins and the refused tw-animate-css
// import in styles/ui.css, and the React-mount adapter here.

const PX = 200 // CSS pixels per world unit
const PANEL_W = 360
const PANEL_H = 460
const W3 = PANEL_W / PX
const H3 = PANEL_H / PX

// How far the floating layer stands off its panel. Big enough to read as a
// separate slab (its own shadow, its own specular) without breaking the
// illusion that it belongs to the card.
const LAYER_LIFT = 0.13

// Viewer chrome. A modal and a toast stack are not attached to any object in
// the scene — they belong to whoever is looking. The slab is sized in source
// pixels like any other Surface, and placed at CHROME_DISTANCE so it spans
// the frustum: at that pose one source pixel is one screen pixel, so
// `position: fixed` inside it means what it says on a page.
const CHROME_W = 1280
const CHROME_H = 720
const CHROME_DISTANCE = 1.15

interface FlightSample {
  t: number
  scale: number
  y: number
  opacity: number
  done: boolean
}
type Lab009Window = Window & {
  __lab009?: { recording: boolean; trace: FlightSample[] }
}

// SurfaceApp — mount a React tree as a Surface's live DOM. A second React
// root renders into the parked source subtree; state, effects, and event
// delegation all run in real DOM, and every commit is a paint the Surface
// uploads like any other mutation. Extraction candidate once the floating
// family (inc 2) needs it too.
function SurfaceApp({
  content,
  width = 640,
  height = 480,
  ...surfaceProps
}: { content: ReactNode } & Omit<
  ComponentProps<typeof Surface>,
  'html' | 'onSource'
>) {
  const rootRef = useRef<Root | null>(null)
  const contentRef = useRef(content)
  contentRef.current = content

  // Re-render the inner tree when the caller passes new content.
  useEffect(() => {
    rootRef.current?.render(content)
  }, [content])

  const mount = useCallback((el: HTMLElement) => {
    const host = document.createElement('div')
    host.className = 'ui-root'
    // The source element is content-sized — the house pattern gives the
    // content root explicit pixel dimensions (every lab's CSS does the
    // same); Surface's width/height size only the canvas.
    host.style.width = `${width}px`
    host.style.height = `${height}px`
    el.appendChild(host)
    const root = createRoot(host)
    root.render(contentRef.current)
    rootRef.current = root
    return () => {
      rootRef.current = null
      host.remove()
      // Unmounting synchronously here would land inside the outer root's
      // commit phase (React warns and defers anyway) — do it cleanly.
      queueMicrotask(() => root.unmount())
    }
  }, [width, height])

  return (
    <Surface {...surfaceProps} width={width} height={height} html="" onSource={mount} />
  )
}

// Chrome that follows the eye.
//
// The obvious implementation is to parent the children to the camera, and it
// does not work: r3f's default camera is NOT in the scene graph (measured —
// `camera.parent === null`). three would compute correct world matrices for
// its children and then never draw them, because the render list is built by
// walking `scene`. Rather than mutate a shared object, this copies the
// camera's pose onto an ordinary scene-level group each frame and pushes it
// forward along the view axis. Same semantics, nothing shared is touched.
//
// Not a frame stale: drei's OrbitControls updates at priority -1 and r3f
// renders after every default-priority callback has run, so the pose this
// writes is the pose that gets drawn.
function CameraChrome({ children, distance = CHROME_DISTANCE }: {
  children: ReactNode
  distance?: number
}) {
  const group = useRef<Group>(null)
  useFrame(({ camera }) => {
    const g = group.current
    if (!g) return
    g.position.copy(camera.position)
    g.quaternion.copy(camera.quaternion)
    g.translateZ(-distance)
  })
  return <group ref={group}>{children}</group>
}

// The chrome slab: one transparent Surface hanging in front of the viewer,
// holding everything that belongs to the viewport rather than to a panel.
//
// Why this is viable at all: `hitTest="content"` (decisions.md #20). A
// full-frustum quad in front of everything would otherwise swallow every ray
// in the scene — the panels behind it would become untouchable, which is the
// increment-2b bug at the largest possible scale. Content-gated, the slab is
// reachable exactly where the DOM painted something and transparent to the
// pointer everywhere else. When a modal IS open its scrim covers the slab and
// blocks the scene, which is precisely what a modal is supposed to do.
//
// The toast stack needs no plumbing whatsoever. Sonner does not portal (zero
// createPortal in its dist) — its Toaster renders inline and pins itself with
// `position: fixed` + corner offsets, and a layoutSubtree canvas IS the
// containing block for fixed descendants (platform.md). So a toaster mounted
// here pins to this slab's corners on its own. `toast()` is a global
// imperative call, so anything anywhere in the scene can raise one.
function ChromeLayer({ onHost }: { onHost: (el: HTMLElement | null) => void }) {
  const { camera, size } = useThree()

  // Span the frustum at the chrome distance, so one source pixel lands on
  // one screen pixel. Recomputed on aspect change only — never per frame.
  const [w3, h3] = useMemo(() => {
    const cam = camera as PerspectiveCamera
    const h = 2 * Math.tan(((cam.fov ?? 45) * Math.PI) / 360) * CHROME_DISTANCE
    return [h * (CHROME_W / CHROME_H), h]
  }, [camera, size.width, size.height])

  // The host is built INSIDE mount, not hoisted into a useMemo. A hoisted
  // node is the right shape for the panel's layer, which is only ever a
  // portal target — but this one also owns a React root, and a remount would
  // then call createRoot on a container whose previous root is still waiting
  // on its unmount microtask. React throws, the throw lands inside
  // CanvasImpl, r3f tears the canvas down, and the GL context goes with it.
  const mount = useCallback(
    (el: HTMLElement) => {
      const host = document.createElement('div')
      host.className = 'ui-layer'
      host.style.width = `${CHROME_W}px`
      host.style.height = `${CHROME_H}px`
      el.appendChild(host)
      const root = createRoot(host)
      root.render(<Toaster position="bottom-right" />)
      onHost(host)
      return () => {
        onHost(null)
        host.remove()
        queueMicrotask(() => root.unmount())
      }
    },
    [onHost],
  )

  return (
    <CameraChrome>
      <Surface
        label="lab009-chrome"
        width={CHROME_W}
        height={CHROME_H}
        html=""
        onSource={mount}
        transparent
        hitTest="content"
      >
        <planeGeometry args={[w3, h3]} />
      </Surface>
    </CameraChrome>
  )
}

// The classic shadcn "Create project" card — recognizable on sight, which
// is the point. React state lives inside the texture: Deploy commits a
// setState, the DOM mutates, the compositor paints, the material updates.
function DeployCard() {
  const [deployed, setDeployed] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  return (
    <Card className="h-full w-full">
      <CardHeader>
        <CardTitle>Create project</CardTitle>
        <CardDescription>Deploy your new project in one-click.</CardDescription>
        <CardAction>
          <Badge variant="secondary">shadcn/ui</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="l9-name">Name</Label>
          <Input id="l9-name" ref={nameRef} placeholder="Name of your project" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="l9-owner">Owner</Label>
          <Input id="l9-owner" placeholder="ember-3" />
        </div>
        <div className="flex items-center gap-2">
          <Badge>New</Badge>
          <Badge variant="outline">Beta</Badge>
          <Badge variant="destructive">Hot</Badge>
        </div>
        {deployed && (
          <p className="text-sm text-muted-foreground" data-deployed>
            {deployed}
          </p>
        )}
      </CardContent>
      <CardFooter className="mt-auto justify-between">
        <Button variant="outline">Cancel</Button>
        {/* One click, two destinations: setState mutates THIS texture, and
            `toast()` raises a notice in the viewer's chrome slab — a
            different Surface, a different pose, no coordinate shared. The
            card knows nothing about where a toast lives. */}
        <Button
          id="l9-deploy"
          onClick={() => {
            const name = nameRef.current?.value || 'untitled'
            setDeployed(`Deploying ${name}…`)
            toast.success('Deployment queued', { description: name })
          }}
        >
          Deploy
        </Button>
      </CardFooter>
    </Card>
  )
}

// The anchored floating family, re-plumbed. Everything here is still
// verbatim shadcn markup; the only addition is `container`, which aims each
// portal at the scene's floating layer instead of document.body.
//
// Dialog aims at a DIFFERENT container from the rest, and that difference is
// the whole content of increment 3. A popover is anchored — it belongs to the
// trigger, so it belongs to the panel, so it goes in the panel's layer. A
// modal is anchored to nothing: it belongs to whoever is looking. So it
// portals into the viewer's chrome slab instead, where `fixed inset-0` scrim
// fills the view and `top-50% left-50%` centres on the eye. Same one-line
// lever, aimed one object further out.
//
// Every component here is still uncontrolled — the scene knows nothing about
// what is open. That is the claim: `container` is the only addition, and the
// layers figure out the rest by watching themselves.
function FloatingCard({ container, chrome }: {
  container: HTMLElement
  chrome: HTMLElement | null
}) {
  const [applied, setApplied] = useState(360)
  const onApply = () => setApplied((w) => w + 20)

  return (
    <TooltipProvider>
      <Card className="h-full w-full">
        <CardHeader>
          <CardTitle>Floating family</CardTitle>
          <CardDescription>Portals aimed at a layer.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Popover>
            <PopoverTrigger asChild>
              <Button id="l9-pop-trigger" variant="outline" className="w-full">
                Configure
              </Button>
            </PopoverTrigger>
            <PopoverContent id="l9-pop-content" container={container}>
              <PopoverHeader>
                <PopoverTitle>Dimensions</PopoverTitle>
                <PopoverDescription>Set the layer size.</PopoverDescription>
              </PopoverHeader>
              {/* Live control inside the floating slab: a pointer has to
                  cross the mesh, get forwarded into the layer's parked DOM,
                  and land on this button for the count to move. */}
              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground" id="l9-pop-count">
                  width {applied}
                </span>
                <Button id="l9-pop-apply" size="sm" onClick={onApply}>
                  Apply
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          {/* `position="popper"` is consumer code, not a port seam: the
              default item-aligned mode sizes itself against the viewport
              (measured 568px tall inside a 460px panel), which is a
              coordinate space a Surface does not live in. */}
          <Select>
            <SelectTrigger id="l9-select-trigger" className="w-full">
              <SelectValue placeholder="Framework" />
            </SelectTrigger>
            <SelectContent
              id="l9-select-content"
              container={container}
              position="popper"
            >
              <SelectItem value="next">Next.js</SelectItem>
              <SelectItem value="remix">Remix</SelectItem>
              <SelectItem value="astro">Astro</SelectItem>
            </SelectContent>
          </Select>

          <Dialog>
            <DialogTrigger asChild>
              <Button
                id="l9-dialog-trigger"
                variant="secondary"
                className="w-full"
              >
                Open dialog
              </Button>
            </DialogTrigger>
            <DialogContent id="l9-dialog-content" container={chrome}>
              <DialogHeader>
                <DialogTitle>Are you sure?</DialogTitle>
                <DialogDescription>
                  This modal hangs in front of the viewer, not the panel.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter showCloseButton>
                <Button
                  id="l9-dialog-confirm"
                  onClick={() => toast.success('Project deleted.')}
                >
                  Delete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button id="l9-tip-trigger" variant="ghost" className="w-full">
                Hover me
              </Button>
            </TooltipTrigger>
            <TooltipContent id="l9-tip-content" container={container}>
              Tooltip in a texture
            </TooltipContent>
          </Tooltip>
        </CardContent>
      </Card>
    </TooltipProvider>
  )
}

// The floating panel: a card slab, and a second slab standing off it that
// holds everything the card's portals emit.
//
// The trick that makes this cheap is a coordinate coincidence that is not a
// coincidence at all: every parked source canvas is `position: fixed` at
// (0,0), and Floating UI positions with `position: fixed` + transform. So
// the popover's page rect is *already* panel-local — the layer canvas is
// the same size as the panel canvas and shares its origin, which means
// Radix's own positioning lands the content in exactly the right place on
// the layer with no projection, no unprojection, and no math from us.
//
// What the layer costs: one 360×460 texture that paints once when empty and
// then only when its contents change. What it buys: real depth. The popover
// is a slab in front of the card — it casts a shadow on it, catches its own
// specular, and occludes it from the side.
function FloatingPanel({ position, rotation, chrome }: {
  position: [number, number, number]
  rotation: [number, number, number]
  chrome: HTMLElement | null
}) {
  const panelGroup = useRef<Group>(null)
  const layerGroup = useRef<Group>(null)
  // Is the layer worth drawing and hit-testing? Exactly when something is
  // mounted in it — occupancy, not any one component's open state.
  //
  // Asking a component instead is the bug this replaced: the slab was tied
  // to the Popover, so a Select or Tooltip opened into a mesh nobody drew,
  // and any flight landing while the popover was shut retired the slab out
  // from under whatever else was showing. Occupancy is also the only signal
  // that keeps the ports verbatim — per-component `open` props would mean
  // wrapping every one of them, and the next library's components would not
  // fit at all.
  const [layerLive, setLayerLive] = useState(false)

  // The portal container. One stable node for the panel's whole life: the
  // card's React root portals into it, the layer Surface rasterizes it.
  const layerHost = useMemo(() => {
    const el = document.createElement('div')
    el.className = 'ui-layer'
    el.style.width = `${PANEL_W}px`
    el.style.height = `${PANEL_H}px`
    return el
  }, [])

  const mountLayer = useCallback(
    (el: HTMLElement) => {
      el.appendChild(layerHost)
      return () => layerHost.remove()
    },
    [layerHost],
  )

  // Occupancy watch. The content is mounted by a DIFFERENT React root (the
  // card's, portaling in), so no effect in this tree ever re-runs when a
  // popover opens — there is nothing passive to observe. childList on the
  // host fires exactly on mount and unmount, which is precisely the two
  // moments that matter, and never in between.
  //
  // This is not the MutationObserver the house rules ban: that one is about
  // Surface's *paint* path, where `onpaint` is already the better change
  // signal. This watches what exists, not when to repaint.
  useEffect(() => {
    const sync = () => setLayerLive(layerHost.childElementCount > 0)
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(layerHost, { childList: true })
    return () => mo.disconnect()
  }, [layerHost])

  useEffect(() => {
    ;(window as Lab009Window).__lab009 = { recording: false, trace: [] }
  }, [])

  // The bridge. shadcn asked for `fade-in-0 zoom-in-95 slide-in-from-top-2`
  // in Tailwind; the conductor reads that curve out of the paused animation
  // and hands it here, one pose per frame, for the mesh to wear.
  useAnimationConductor(layerHost, (v, done) => {
    const g = layerGroup.current
    if (!g) return

    // CSS scales about the content's own transform-origin, near the
    // trigger. A group scales about its own origin, at the panel's center —
    // so pivot-correct: p + (x - p)·s is the same as scaling about the
    // origin and translating by p·(1 - s).
    const rect = layerHost
      .querySelector('[data-slot$="-content"]')
      ?.getBoundingClientRect()
    const pivotX = rect ? (rect.left + rect.width / 2 - PANEL_W / 2) / PX : 0
    const pivotY = rect ? -(rect.top + rect.height / 2 - PANEL_H / 2) / PX : 0

    g.scale.setScalar(v.scale)
    g.position.set(
      pivotX * (1 - v.scale) + v.x / PX,
      pivotY * (1 - v.scale) - v.y / PX, // DOM y grows down; world y grows up
      LAYER_LIFT,
    )
    g.traverse((o) => {
      const mat = (o as Mesh).material
      if (mat && !Array.isArray(mat)) mat.opacity = v.opacity
    })

    // Scene hook: the house pattern for browser-verifying a lab. Records
    // what the mesh actually wore, frame by frame, so a probe can read the
    // flight back without racing the render loop.
    const hook = (window as Lab009Window).__lab009
    if (hook?.recording) {
      hook.trace.push({ t: performance.now(), scale: v.scale, y: v.y, opacity: v.opacity, done })
    }

    // Nothing to do when a flight lands. The mesh landing makes the
    // conductor call finish(), which fires animationend, which lets Presence
    // unmount the content — and that unmount is itself the childList
    // mutation that retires the slab. Retiring it from here instead was the
    // bug: `done` arrives for entrances too.
    void done
  })

  return (
    <group position={position} rotation={rotation} ref={panelGroup}>
      <FocusGroup id="shadcn-floating" order={1} objectRef={panelGroup}>
        <SurfaceApp
          content={
            <FloatingCard container={layerHost} chrome={chrome} />
          }
          label="lab009-floating"
          width={PANEL_W}
          height={PANEL_H}
          castShadow
        >
          <planeGeometry args={[W3, H3]} />
        </SurfaceApp>
      </FocusGroup>

      {/* The floating layer. Same size and origin as the panel, standing
          off it along the normal. Transparent everywhere the DOM painted
          nothing — to the eye AND to the raycaster, so rays through the
          clear part reach the card behind instead of stopping at glass.
          `hitTest="content"` subsumes the old liveness gate: an empty layer
          accepts the pointer nowhere, so it is inert by construction. */}
      <group ref={layerGroup} name="l9-layer" position={[0, 0, LAYER_LIFT]} visible={layerLive}>
        <Surface
          label="lab009-layer"
          width={PANEL_W}
          height={PANEL_H}
          html=""
          onSource={mountLayer}
          transparent
          castShadow
          hitTest="content"
        >
          <planeGeometry args={[W3, H3]} />
        </Surface>
      </group>
    </group>
  )
}

export function Lab009() {
  const group = useRef<Group>(null)
  // The chrome slab's portal container, published once it mounts. Everything
  // viewer-owned aims here: the Dialog's portal, and (implicitly) any toast.
  const [chrome, setChrome] = useState<HTMLElement | null>(null)

  return (
    <>
      <fog attach="fog" args={['#101014', 10, 26]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 7, 4]} intensity={1.4} castShadow />
      <pointLight position={[-3, 3, 3]} intensity={14} color="#9db4ff" distance={12} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <circleGeometry args={[12, 64]} />
        <meshStandardMaterial color="#15161c" roughness={0.95} />
      </mesh>

      <group position={[0, 1.5, 0]} rotation={[0, -0.16, 0]} ref={group}>
        <FocusGroup id="shadcn-card" order={0} objectRef={group}>
          <SurfaceApp
            content={<DeployCard />}
            label="lab009-card"
            width={PANEL_W}
            height={PANEL_H}
            castShadow
          >
            <planeGeometry args={[W3, H3]} />
          </SurfaceApp>
        </FocusGroup>
      </group>

      <FloatingPanel
        position={[2.05, 1.5, 0.25]}
        rotation={[0, -0.45, 0]}
        chrome={chrome}
      />

      <ChromeLayer onHost={setChrome} />
    </>
  )
}
