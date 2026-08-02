import { Suspense, useEffect, useMemo, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, OrbitControls } from '@react-three/drei'
import { Lab001 } from './scenes/Lab001'
import { Lab002 } from './scenes/Lab002'
import { Lab003 } from './scenes/Lab003'
import { Lab004 } from './scenes/Lab004'
import { Lab005 } from './scenes/Lab005'
import { Lab006, Lab006Hud } from './scenes/Lab006'
import { Lab008 } from './scenes/Lab008'
import { Lab009 } from './scenes/Lab009'
import { Lab010 } from './scenes/Lab010'
import { ProbeScaleApp } from './scenes/ProbeScale'
import { ProbeFocusApp } from './scenes/ProbeFocus'
import { ProbeLayoutApp } from './scenes/ProbeLayout'
import { ProbeStyleApp } from './scenes/ProbeStyle'
import { detectHtmlInCanvas, FocusScene } from 'three-ui'

type LabId = '001' | '002' | '003' | '004' | '005' | '006' | '008' | '009' | '010'

// ?probe=N mounts the scale probe instead of the labs (see ProbeScale.tsx).
function probeParams() {
  const params = new URLSearchParams(window.location.search)
  const raw = params.get('probe')
  if (!raw) return null
  const n = Math.max(1, Math.min(128, parseInt(raw, 10) || 0))
  if (!n) return null
  return {
    n,
    live: params.get('live') === '1',
    anim: Math.max(0, parseInt(params.get('anim') ?? '', 10) || 0),
    cardW: Math.max(64, Math.min(1024, parseInt(params.get('w') ?? '', 10) || 320)),
    cardH: Math.max(64, Math.min(1024, parseInt(params.get('h') ?? '', 10) || 200)),
  }
}

// Clicking a canvas normally moves focus to <body>, which would blur
// whatever hidden form field a Surface has focused — killing native typing.
// Preventing mousedown's default suppresses that focus change (drags and
// clicks still work).
function KeepDomFocus() {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const el = gl.domElement
    const noSteal = (e: MouseEvent) => e.preventDefault()
    el.addEventListener('mousedown', noSteal)
    return () => el.removeEventListener('mousedown', noSteal)
  }, [gl])
  return null
}

export default function App() {
  const support = useMemo(detectHtmlInCanvas, [])
  const probe = useMemo(probeParams, [])
  const focusProbe = useMemo(
    () => new URLSearchParams(window.location.search).get('focusprobe') === '1',
    [],
  )
  const layoutProbe = useMemo(
    () => new URLSearchParams(window.location.search).get('layoutprobe') === '1',
    [],
  )
  const styleProbe = useMemo(
    () => new URLSearchParams(window.location.search).get('styleprobe') === '1',
    [],
  )
  const [lab, setLab] = useState<LabId>('006')

  if (focusProbe) return <ProbeFocusApp />
  if (layoutProbe) return <ProbeLayoutApp />
  if (styleProbe) return <ProbeStyleApp />
  if (probe) return <ProbeScaleApp {...probe} />

  return (
    <div className="app">
      <Canvas
        shadows
        camera={{ position: [0, 2.5, 9], fov: 45 }}
        dpr={[1, 2]}
        onCreated={(state) => {
          // Dev diagnostics: lets automation inspect the scene graph.
          ;(window as unknown as { __r3f: unknown }).__r3f = state
        }}
      >
        <KeepDomFocus />
        <FocusScene>
          <Suspense fallback={null}>
            <Environment preset="city" />
            {lab === '001' ? (
              <Lab001 />
            ) : lab === '002' ? (
              <Lab002 />
            ) : lab === '003' ? (
              <Lab003 />
            ) : lab === '004' ? (
              <Lab004 />
            ) : lab === '005' ? (
              <Lab005 />
            ) : lab === '008' ? (
              <Lab008 />
            ) : lab === '009' ? (
              <Lab009 />
            ) : lab === '010' ? (
              <Lab010 />
            ) : (
              <Lab006 />
            )}
            <ContactShadows position={[0, -0.15, 0]} opacity={0.5} blur={2.2} scale={20} />
            <OrbitControls
              makeDefault
              enableDamping
              target={[0, 1.4, 0]}
              maxPolarAngle={Math.PI / 2.05}
              minDistance={3}
              maxDistance={16}
            />
          </Suspense>
        </FocusScene>
      </Canvas>

      <div className="hud">
        <h1>three-ui / lab {lab}</h1>
        <p className="sub">a component library made of real materials</p>
        <div className="tabs">
          {(['001', '002', '003', '004', '005', '006', '008', '009', '010'] as const).map((id) => (
            <button
              key={id}
              data-active={lab === id}
              onClick={() => setLab(id)}
            >
              lab {id}
            </button>
          ))}
        </div>
        <ul className="features">
          <li data-ok={support.drawElementImage}>
            drawElementImage {support.drawElementImage ? '✓' : '✗'}
          </li>
          <li data-ok={support.texElementImage2D}>
            texElementImage2D {support.texElementImage2D ? '✓' : '✗'}
          </li>
        </ul>
        {!support.drawElementImage && (
          <p className="hint">
            HTML-in-canvas unavailable — lab 002's Surface needs it. Chrome
            148–151 with <code>chrome://flags/#canvas-draw-element</code>.
          </p>
        )}
      </div>

      <div className="footer">
        {lab === '001'
          ? 'drag to orbit · press the button · click the hopper to drop chips'
          : lab === '002'
            ? 'click the console fields, then just type · toggle stealth · fling the card'
            : lab === '003'
              ? 'open the mode picker — the dropdown is its own Surface · __threeUI.stats() for paint counts'
              : lab === '004'
                ? 'open both pickers — same anchor code on flat and curved skin · the flag tag rides the wave'
                : lab === '005'
                  ? 'flick the dial · tap the toggles · throw the slider — one integrator, three force fields'
                  : lab === '008'
                    ? 'Tab surveys · Enter approaches · Escape steps home — every import from the public barrel'
                    : lab === '009'
                      ? 'verbatim shadcn/ui painted as matter · click into a field and type · press Deploy'
                      : lab === '010'
                        ? 'wheel over the log to scroll it · wheel over the floor to zoom · ask the agent something'
                        : 'double-click a panel to approach · double-click the floor to step back · drag a title bar · click into text and type'}
      </div>
      {lab === '006' && <Lab006Hud />}
    </div>
  )
}
