import { Suspense, useEffect, useMemo, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, OrbitControls } from '@react-three/drei'
import { Lab001 } from './scenes/Lab001'
import { Lab002 } from './scenes/Lab002'
import { Lab003 } from './scenes/Lab003'
import { Lab004 } from './scenes/Lab004'
import { detectHtmlInCanvas } from './lib/htmlInCanvas'

type LabId = '001' | '002' | '003' | '004'

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
  const [lab, setLab] = useState<LabId>('004')

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
        <Suspense fallback={null}>
          <Environment preset="city" />
          {lab === '001' ? (
            <Lab001 />
          ) : lab === '002' ? (
            <Lab002 />
          ) : lab === '003' ? (
            <Lab003 />
          ) : (
            <Lab004 />
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
      </Canvas>

      <div className="hud">
        <h1>three-ui / lab {lab}</h1>
        <p className="sub">a component library made of real materials</p>
        <div className="tabs">
          {(['001', '002', '003', '004'] as const).map((id) => (
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
            148–150 with <code>chrome://flags/#canvas-draw-element</code>.
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
              : 'open both pickers — same anchor code on flat and curved skin · the flag tag rides the wave'}
      </div>
    </div>
  )
}
