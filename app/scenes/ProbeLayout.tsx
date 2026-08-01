import { useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { detectHtmlInCanvas, DomLayout, LayoutSlot, SurfaceApp } from 'three-ui'

// Layout-oracle probe — not a lab. Answers four questions about DomLayout:
//
//   1. Parity: do the panes' world poses match the boxes real CSS computed?
//      (Verified from the driver: project each named mesh, compare against
//      the rig's own offset boxes.)
//   2. Motion: does a transitioned layout property (the sidebar's width)
//      stream poses per frame — panels gliding, not jumping?
//   3. Cost: what does an animated reflow cost in paints and reallocs, per
//      resizing pane and per merely-moving pane?
//   4. Container queries: does shrinking the RIG (not the window) hide the
//      log pane and hand its room to the others?
//
// Mount via URL: ?layoutprobe=1
// Drive from the console / agent-browser:
//   __layoutProbe.rig            — the hidden layout container
//   __layoutProbe.collapse(on)   — toggle the sidebar class (transitioned)
//   __layoutProbe.setRig(w, h)   — resize the layout viewport
//   __layoutProbe.boxes()        — serialized [data-pane] offset boxes

// The arrangement is authored as markup — this string is the whole layout
// authority. Plain CSS on purpose: the probe measures the oracle, not the
// toolchain. `@container` resolves against the rig (container-type: size),
// NOT the window — that's the platform finding this probe banks.
const RIG = `
<style>
  .plr { display: flex; gap: 24px; padding: 32px; width: 100%; height: 100%;
         box-sizing: border-box; }
  .plr .side { width: 240px; transition: width 350ms ease; }
  .plr.collapsed .side { width: 72px; }
  .plr .col { flex: 1; display: flex; flex-direction: column; gap: 24px;
              min-width: 0; }
  .plr .main { flex: 1; }
  .plr .composer { height: 120px; }
  .plr .log { width: 320px; }
  @container (max-width: 999px) { .plr .log { display: none; } }
</style>
<div class="plr">
  <div data-pane="side" class="side"></div>
  <div class="col">
    <div data-pane="main" class="main"></div>
    <div data-pane="composer" class="composer"></div>
  </div>
  <div data-pane="log" class="log"></div>
</div>`

function PaneContent({ label, hue }: { label: string; hue: number }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        padding: 18,
        fontFamily: 'ui-monospace, monospace',
        fontSize: 13,
        color: '#f8fafc',
        background: `oklch(0.25 0.04 ${hue})`,
        border: `1px solid oklch(0.55 0.12 ${hue})`,
        borderRadius: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <strong>{label}</strong>
      <span style={{ color: '#94a3b8' }}>
        The quick brown fox jumps over the lazy dog — this line rewraps when
        the layout hands this pane a different width.
      </span>
    </div>
  )
}

const PANES: Array<{ pane: string; label: string; hue: number }> = [
  { pane: 'side', label: 'sidebar', hue: 250 },
  { pane: 'main', label: 'main', hue: 160 },
  { pane: 'composer', label: 'composer', hue: 80 },
  { pane: 'log', label: 'log', hue: 20 },
]

declare global {
  interface Window {
    __layoutProbe?: {
      rig: HTMLElement | null
      collapse: (on: boolean) => void
      setRig: (w: number, h: number) => void
      boxes: () => Record<string, { x: number; y: number; w: number; h: number }>
    }
  }
}

export function ProbeLayoutApp() {
  const support = useMemo(detectHtmlInCanvas, [])
  const rigRef = useRef<HTMLElement | null>(null)
  // Rig size lives in React state so the probe's setRig drives DomLayout's
  // ordinary prop path, not a side channel.
  const [rigSize, setRigSize] = useState({ w: 1280, h: 800 })

  useMemo(() => {
    window.__layoutProbe = {
      rig: null,
      collapse(on) {
        rigRef.current
          ?.querySelector('.plr')
          ?.classList.toggle('collapsed', on)
      },
      setRig(w, h) {
        setRigSize({ w, h })
      },
      boxes() {
        const out: Record<string, { x: number; y: number; w: number; h: number }> = {}
        for (const el of rigRef.current?.querySelectorAll<HTMLElement>('[data-pane]') ?? []) {
          if (el.offsetWidth === 0 && el.offsetHeight === 0) continue
          out[el.getAttribute('data-pane')!] = {
            x: el.offsetLeft,
            y: el.offsetTop,
            w: el.offsetWidth,
            h: el.offsetHeight,
          }
        }
        return out
      },
    }
  }, [rigRef])

  return (
    <div className="app">
      <Canvas
        camera={{ position: [0, 0, 8], fov: 45 }}
        dpr={[1, 2]}
        onCreated={(state) => {
          ;(window as unknown as { __r3f: unknown }).__r3f = state
        }}
      >
        <ambientLight intensity={1.1} />
        <directionalLight position={[2, 4, 5]} intensity={1.2} />
        <DomLayout
          html={RIG}
          width={rigSize.w}
          height={rigSize.h}
          px={200}
          onElement={(el) => {
            rigRef.current = el
            if (window.__layoutProbe) window.__layoutProbe.rig = el
          }}
        >
          {PANES.map(({ pane, label, hue }) => (
            <LayoutSlot key={pane} pane={pane}>
              {(box) => (
                <SurfaceApp
                  name={`pane-${pane}`}
                  label={`pane-${pane}`}
                  width={box.width}
                  height={box.height}
                  content={<PaneContent label={label} hue={hue} />}
                >
                  <planeGeometry args={[box.worldWidth, box.worldHeight]} />
                </SurfaceApp>
              )}
            </LayoutSlot>
          ))}
        </DomLayout>
        <OrbitControls makeDefault enableDamping />
      </Canvas>
      <div className="hud">
        <h1>three-ui / layout probe</h1>
        <ul className="features">
          <li data-ok={support.drawElementImage}>
            drawElementImage {support.drawElementImage ? '✓' : '✗'}
          </li>
          <li data-ok={support.texElementImage2D}>
            texElementImage2D {support.texElementImage2D ? '✓' : '✗'}
          </li>
        </ul>
      </div>
    </div>
  )
}
