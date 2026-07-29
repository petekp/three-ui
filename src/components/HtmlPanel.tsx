import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Html, Text } from '@react-three/drei'
import { useFrame, type ThreeElements } from '@react-three/fiber'
import {
  createDomTextureSource,
  detectHtmlInCanvas,
  type DomTextureSource,
} from '../lib/htmlInCanvas'

const PANEL_W = 512
const PANEL_H = 384

// The experiment this whole project hinges on: can a real, live DOM form be
// the surface of a 3D object?
//
// Path A (origin trial): a live DOM form lives as a child of a hidden
// `layoutSubtree` canvas; each frame we requestPaint() and drawElementImage
// rasterizes it, which three consumes as a CanvasTexture. Live DOM → live
// material (one frame of latency, no input forwarding yet).
//
// Path B (fallback, works everywhere): drei's <Html transform> — CSS3D-matched
// DOM floating in the scene. Fully interactive, but it's an overlay, not a
// texture, so it can't receive lighting, shadows, or refraction.

function formMarkup() {
  return `
    <div style="width:${PANEL_W}px;height:${PANEL_H}px;box-sizing:border-box;padding:28px;
                font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc;
                display:flex;flex-direction:column;gap:14px;border-radius:12px;">
      <strong style="font-size:22px">Sign in</strong>
      <span style="font-size:13px;color:#94a3b8">This is a real DOM form, rasterized into a WebGL texture.</span>
      <input placeholder="email" style="padding:12px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#f8fafc;font-size:14px" />
      <input placeholder="password" type="password" style="padding:12px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#f8fafc;font-size:14px" />
      <button style="padding:12px;border-radius:8px;border:0;background:#38bdf8;color:#082f49;font-size:14px;font-weight:600">Continue</button>
      <span data-clock style="font-size:11px;color:#64748b;font-family:ui-monospace,monospace"></span>
    </div>`
}

/** Path A: live DOM rasterized into a CanvasTexture via drawElementImage. */
function useDomTexture(enabled: boolean) {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null)
  const [failed, setFailed] = useState(false)
  const sourceRef = useRef<DomTextureSource | null>(null)

  useEffect(() => {
    if (!enabled) return
    const source = createDomTextureSource(formMarkup(), PANEL_W, PANEL_H, {
      label: 'lab001-panel',
      onError: (err) => {
        console.warn('[three-ui] drawElementImage failed:', err)
        setFailed(true)
      },
    })
    sourceRef.current = source

    // Live clock inside the DOM — proof the texture tracks a *live* subtree.
    const clock = source.element.querySelector('[data-clock]')!
    const tick = setInterval(() => {
      clock.textContent = `live DOM · ${new Date().toLocaleTimeString()}`
    }, 1000)

    const tex = new THREE.CanvasTexture(source.canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    setTexture(tex)

    return () => {
      clearInterval(tick)
      tex.dispose()
      source.dispose()
      sourceRef.current = null
      setTexture(null)
    }
  }, [enabled])

  useFrame(() => {
    const source = sourceRef.current
    if (!source || !texture) return
    source.repaint()
    // Deferred paint: pixels land after the paint cycle; re-upload each frame.
    if (source.painted()) texture.needsUpdate = true
  })

  return { texture, failed }
}

export function HtmlPanel(props: ThreeElements['group']) {
  const support = useMemo(detectHtmlInCanvas, [])
  const { texture, failed } = useDomTexture(support.drawElementImage)
  const usingTrial = support.drawElementImage && !failed && texture !== null

  return (
    <group {...props}>
      {usingTrial ? (
        <mesh castShadow>
          <planeGeometry args={[PANEL_W / 160, PANEL_H / 160]} />
          <meshStandardMaterial map={texture} roughness={0.4} metalness={0.1} />
        </mesh>
      ) : (
        // Fallback: interactive DOM matched into the scene via CSS3D.
        <Html transform scale={0.2} position={[0, 0, 0.01]}>
          <div dangerouslySetInnerHTML={{ __html: formMarkup() }} />
        </Html>
      )}

      <Text position={[0, -1.6, 0]} fontSize={0.16} color="#94a3b8" anchorX="center">
        {usingTrial
          ? '<HtmlSurface /> · drawElementImage ✓ (live DOM texture)'
          : '<HtmlSurface /> · fallback: drei <Html> (CSS3D overlay)'}
      </Text>
    </group>
  )
}
