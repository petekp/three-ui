import { useEffect, useRef, useState } from 'react'
import type { Group } from 'three'
import { toast } from 'sonner'
import {
  AnchoredSurface,
  FloatingSurface,
  FocusGroup,
  SurfaceApp,
  ViewerSurface,
  type MotionValue,
} from 'three-ui'
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

// Lab 009 — shadcn as matter.
//
// The components below are byte-verbatim from the shadcn registry
// (new-york-v4); nothing about them knows it is being rasterized into a WebGL
// material. Read this file as consumer code: everything imported from
// `../index` is library, and the only thing this scene does to a shadcn
// component is hand it a `container`.
//
// The three seams of the port live elsewhere — the hover/active variant twins
// and the detach rule in styles/ui.css, and `SurfaceApp`'s React-root adapter.

const PX = 200 // CSS pixels per world unit
const PANEL_W = 360
const PANEL_H = 460
const W3 = PANEL_W / PX
const H3 = PANEL_H / PX

interface FlightSample {
  t: number
  scale: number
  y: number
  opacity: number
  done: boolean
}
type Lab009Window = Window & {
  __lab009?: {
    recording: boolean
    trace: FlightSample[]
    detachedTrace: FlightSample[]
  }
}

// Append a flight frame to one of the hook's traces, if a probe is listening.
function recordInto(key: 'trace' | 'detachedTrace') {
  return (v: MotionValue, done: boolean) => {
    const hook = (window as Lab009Window).__lab009
    if (!hook?.recording) return
    hook[key].push({
      t: performance.now(),
      scale: v.scale,
      y: v.y,
      opacity: v.opacity,
      done,
    })
  }
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

// One card, three destinations — and the destination is the only thing this
// scene contributes. Everything here is verbatim shadcn markup; the sole
// addition is `container`, and where each one points is the whole argument of
// increments 2 through 4.
//
// A Select or Tooltip is anchored: it belongs to its trigger, so it belongs
// to the panel, so it goes in the panel's own layer. A modal is anchored to
// nothing — it belongs to whoever is looking — so it portals into the
// viewer's slab. And a popover, being a small standalone thing you might want
// to walk around, can be furniture: its own object out in the room.
//
// Every component stays uncontrolled. The scene never learns what is open;
// the layers work that out by watching themselves.
function FloatingCard({ container, chrome, detached }: {
  container: HTMLElement
  chrome: HTMLElement | null
  detached: HTMLElement | null
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
            {/* The one component in this card aimed at a DETACHED surface.
                Everything else still portals into the anchored layer, so the
                two idioms stand side by side: the Select and Tooltip are
                decals on this panel, and this popover is its own object out
                in the room. The only difference is which container it names —
                `side`/`align`/`sideOffset` are still authored here and are
                simply ignored once placement is revoked. */}
            <PopoverContent id="l9-pop-content" container={detached ?? container}>
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

// A card slab with an anchored layer standing off it. That is the entire
// composition: `SurfaceApp` paints the card, `AnchoredSurface` holds whatever
// it opens, and the two are siblings in one group so the pair moves together.
function FloatingPanel({ position, rotation, chrome, detached }: {
  position: [number, number, number]
  rotation: [number, number, number]
  chrome: HTMLElement | null
  detached: HTMLElement | null
}) {
  const panelGroup = useRef<Group>(null)
  const [container, setContainer] = useState<HTMLElement | null>(null)

  // Scene hook: the house pattern for browser-verifying a lab. Records what
  // the layer mesh actually wore, frame by frame, so a probe can read a
  // flight back without racing the render loop.
  useEffect(() => {
    ;(window as Lab009Window).__lab009 = {
      recording: false,
      trace: [],
      detachedTrace: [],
    }
  }, [])
  const record = recordInto('trace')

  return (
    <group position={position} rotation={rotation} ref={panelGroup}>
      <FocusGroup id="shadcn-floating" order={1} objectRef={panelGroup}>
        {container && (
          <SurfaceApp
            content={
              <FloatingCard
                container={container}
                chrome={chrome}
                detached={detached}
              />
            }
            label="lab009-floating"
            width={PANEL_W}
            height={PANEL_H}
            castShadow
          >
            <planeGeometry args={[W3, H3]} />
          </SurfaceApp>
        )}
      </FocusGroup>

      <AnchoredSurface
        label="lab009-layer"
        width={PANEL_W}
        height={PANEL_H}
        px={PX}
        onHost={setContainer}
        onFlight={record}
      />
    </group>
  )
}

export function Lab009() {
  const group = useRef<Group>(null)

  // The two containers this scene publishes. Both are just DOM nodes that
  // some other Surface happens to rasterize; the cards holding the portals
  // never learn where either one ended up in the world.
  const [chrome, setChrome] = useState<HTMLElement | null>(null)
  const [detached, setDetached] = useState<HTMLElement | null>(null)

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
        detached={detached}
      />

      {/* The detached popover, standing on its own in the room. Its content
          comes from a card two objects away, through nothing but a container
          reference — no coordinate, no projection, no parent in common except
          the scene itself. Move this `position` and the popover moves; the
          card does not notice. */}
      <FloatingSurface
        label="lab009-detached"
        onHost={setDetached}
        onFlight={recordInto('detachedTrace')}
        position={[-1.02, 1.02, 0.5]}
        rotation={[0, 0.34, 0]}
      />

      {/* Viewer chrome. The toast stack needs no plumbing whatsoever: sonner
          renders inline and pins itself `position: fixed`, and a layoutSubtree
          canvas IS the containing block for fixed descendants — so it pins to
          this slab's corners on its own. `toast()` is a global imperative
          call, so anything anywhere in the scene can raise one. */}
      <ViewerSurface
        label="lab009-chrome"
        onHost={setChrome}
        content={<Toaster position="bottom-right" />}
      />
    </>
  )
}
