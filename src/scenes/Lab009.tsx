import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Group } from 'three'
import { FocusGroup, Surface } from '../index'
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

// Lab 009 — shadcn as matter. The components below are byte-verbatim from
// the shadcn registry (new-york-v4); nothing about them knows it is being
// rasterized into a WebGL material. The three seams of the port live
// elsewhere: the hover/active variant twins and the refused tw-animate-css
// import in styles/ui.css, and the React-mount adapter here.

const PANEL_W = 360
const PANEL_H = 460
const W3 = PANEL_W / 200
const H3 = PANEL_H / 200

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
        <Button
          onClick={() =>
            setDeployed(`Deploying ${nameRef.current?.value || 'untitled'}…`)
          }
        >
          Deploy
        </Button>
      </CardFooter>
    </Card>
  )
}

export function Lab009() {
  const group = useRef<Group>(null)

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
    </>
  )
}
