import { useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { Group } from 'three'
import { detectHtmlInCanvas, SurfaceApp, useStyleChannel } from 'three-ui'

// Style-bridge probe — not a lab. Answers three questions about a CSS
// custom-property channel (decisions #28):
//
//   1. Easing: does getComputedStyle mid-transition return genuinely eased
//      intermediates — CSS's own curve, not a linear ramp?
//   2. Cost: does a full transition of `--depth` paint NOTHING? The card's
//      paint counter (__threeUI.stats()) must not move while the mesh glides.
//   3. Variants: does the hover twin ([data-hover], set by forwarded events)
//      flip the variant through the texture — pointer over the mesh, card
//      lifts with CSS timing?
//
// Mount via URL: ?styleprobe=1
// Drive from the console / agent-browser:
//   __styleProbe.el          — the channel element (the card root)
//   __styleProbe.lift(on)    — toggle [data-lifted] (the no-pointer variant)
//   __styleProbe.sample()    — current computed --depth
//   __styleProbe.trace(ms)   — per-frame {t, depth, z} samples for ms
//   __styleProbe.meshZ()     — the group's current world z

const CARD_CSS = `
  .depth-card {
    --depth: 0;
    transition: --depth 600ms cubic-bezier(0.22, 1, 0.36, 1);
    width: 100%; height: 100%; box-sizing: border-box; padding: 24px;
    font-family: ui-monospace, monospace; font-size: 14px;
    color: #f8fafc; background: oklch(0.24 0.05 265);
    border: 1px solid oklch(0.5 0.12 265); border-radius: 12px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .depth-card:hover, .depth-card[data-hover], .depth-card[data-lifted] {
    --depth: 1;
    border-color: oklch(0.75 0.15 265);
  }
`

function CardContent({ onRoot }: { onRoot: (el: HTMLElement | null) => void }) {
  return (
    <>
      <style>{CARD_CSS}</style>
      <div className="depth-card" ref={onRoot}>
        <strong>--depth channel</strong>
        <span style={{ color: '#94a3b8' }}>
          Hover me. The lift you see is the mesh polling this card&apos;s
          computed <code>--depth</code> — CSS owns the value, the timing and
          the curve; nothing here repaints while it moves.
        </span>
      </div>
    </>
  )
}

// The scene half: a group wearing the card, lifted and tilted by the channel.
function DepthCard({ card, onCard }: {
  card: HTMLElement | null
  onCard: (el: HTMLElement | null) => void
}) {
  const depth = useStyleChannel('--depth', { element: card })
  const group = useRef<Group>(null)

  useFrame(() => {
    const g = group.current
    if (!g) return
    const d = depth()
    g.position.z = d * 0.8
    g.rotation.x = d * -0.12
  })

  useMemo(() => {
    window.__styleProbe = {
      el: card,
      lift(on) {
        card?.toggleAttribute('data-lifted', on)
      },
      sample() {
        return card ? parseFloat(getComputedStyle(card).getPropertyValue('--depth')) || 0 : 0
      },
      trace(ms) {
        return new Promise((resolve) => {
          const out: Array<{ t: number; depth: number; z: number }> = []
          const t0 = performance.now()
          const step = () => {
            const t = performance.now() - t0
            out.push({
              t: Math.round(t),
              depth: window.__styleProbe!.sample(),
              z: group.current?.position.z ?? 0,
            })
            if (t < ms) requestAnimationFrame(step)
            else resolve(out)
          }
          requestAnimationFrame(step)
        })
      },
      meshZ() {
        return group.current?.position.z ?? 0
      },
    }
  }, [card])

  return (
    <group ref={group}>
      <SurfaceApp
        name="depth-card"
        label="depth-card"
        width={420}
        height={240}
        content={<CardContent onRoot={onCard} />}
      >
        <planeGeometry args={[2.6, 1.5]} />
      </SurfaceApp>
    </group>
  )
}

declare global {
  interface Window {
    __styleProbe?: {
      el: HTMLElement | null
      lift: (on: boolean) => void
      sample: () => number
      trace: (ms: number) => Promise<Array<{ t: number; depth: number; z: number }>>
      meshZ: () => number
    }
  }
}

export function ProbeStyleApp() {
  const support = useMemo(detectHtmlInCanvas, [])
  const [card, setCard] = useState<HTMLElement | null>(null)

  return (
    <div className="app">
      <Canvas
        camera={{ position: [0, 0.4, 5], fov: 45 }}
        dpr={[1, 2]}
        onCreated={(state) => {
          ;(window as unknown as { __r3f: unknown }).__r3f = state
        }}
      >
        <ambientLight intensity={1.1} />
        <directionalLight position={[2, 4, 5]} intensity={1.2} />
        <DepthCard card={card} onCard={setCard} />
        <OrbitControls makeDefault enableDamping />
      </Canvas>
      <div className="hud">
        <h1>three-ui / style probe</h1>
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
