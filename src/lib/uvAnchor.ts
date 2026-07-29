import * as THREE from 'three'

// UV→surface inversion: given a (u, v) texture coordinate, find the point on
// a BufferGeometry's surface that the texture maps to. This is the inverse of
// what the raycaster gives us (hit → UV); anchors need the other direction
// (UV → position + normal) so floating layers can attach to a spot on a
// Surface's skin, whatever shape that skin is.
//
// The trick that makes this cheap for deforming geometry: the search — which
// triangle contains (u, v), and where inside it (barycentric weights) — only
// depends on the UV attribute, which is static even when vertices move. So an
// anchor resolves its triangle ONCE, then each sample() is three attribute
// reads and a weighted sum against the LIVE position/normal buffers. O(1) per
// frame; the anchor rides the deformation for free.
//
// Known limits (deliberate): GPU/shader displacement is invisible here (same
// limit as raycast forwarding — CPU-side positions only), and if a UV point is
// covered by multiple triangles (overlapping UV islands) the first found wins.

export interface SurfaceSample {
  position: THREE.Vector3
  normal: THREE.Vector3
}

interface TrianglePick {
  ia: number
  ib: number
  ic: number
  wa: number
  wb: number
  wc: number
}

// Tolerance for "inside the triangle": lets exact edge/corner hits (u=0, u=1)
// pass despite floating-point noise.
const EDGE_EPS = 1e-6

function pickTriangle(
  geometry: THREE.BufferGeometry,
  u: number,
  v: number,
): TrianglePick | null {
  const uv = geometry.attributes.uv as THREE.BufferAttribute | undefined
  if (!uv) return null
  const index = geometry.index
  const triCount = (index ? index.count : geometry.attributes.position.count) / 3

  for (let t = 0; t < triCount; t++) {
    const ia = index ? index.getX(t * 3) : t * 3
    const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1
    const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2

    const ua = uv.getX(ia)
    const va = uv.getY(ia)
    const ub = uv.getX(ib)
    const vb = uv.getY(ib)
    const uc = uv.getX(ic)
    const vc = uv.getY(ic)

    // Barycentric coordinates of (u, v) in the UV-space triangle: solve the
    // 2×2 linear system  (u,v) = wa·A + wb·B + wc·C  with wa+wb+wc = 1.
    const denom = (vb - vc) * (ua - uc) + (uc - ub) * (va - vc)
    if (Math.abs(denom) < 1e-12) continue // degenerate UV triangle (zero area)
    const wa = ((vb - vc) * (u - uc) + (uc - ub) * (v - vc)) / denom
    const wb = ((vc - va) * (u - uc) + (ua - uc) * (v - vc)) / denom
    const wc = 1 - wa - wb

    if (wa >= -EDGE_EPS && wb >= -EDGE_EPS && wc >= -EDGE_EPS) {
      return { ia, ib, ic, wa, wb, wc }
    }
  }
  return null
}

const _ab = new THREE.Vector3()
const _ac = new THREE.Vector3()
const _a = new THREE.Vector3()

/**
 * A (u, v) point pinned to a geometry's surface. Construct once (topology
 * search), then sample() every frame — it reads the live attributes, so CPU
 * deformation carries the anchor with it.
 */
export class UVAnchor {
  readonly valid: boolean
  private pick: TrianglePick | null
  private geometry: THREE.BufferGeometry

  constructor(geometry: THREE.BufferGeometry, u: number, v: number) {
    this.geometry = geometry
    this.pick = pickTriangle(geometry, u, v)
    this.valid = this.pick !== null
  }

  /** Local-space position + unit normal at the anchor, or null if invalid. */
  sample(target?: SurfaceSample): SurfaceSample | null {
    const p = this.pick
    if (!p) return null
    const out = target ?? {
      position: new THREE.Vector3(),
      normal: new THREE.Vector3(),
    }

    const pos = this.geometry.attributes.position as THREE.BufferAttribute
    out.position.set(
      p.wa * pos.getX(p.ia) + p.wb * pos.getX(p.ib) + p.wc * pos.getX(p.ic),
      p.wa * pos.getY(p.ia) + p.wb * pos.getY(p.ib) + p.wc * pos.getY(p.ic),
      p.wa * pos.getZ(p.ia) + p.wb * pos.getZ(p.ib) + p.wc * pos.getZ(p.ic),
    )

    const nrm = this.geometry.attributes.normal as THREE.BufferAttribute | undefined
    if (nrm) {
      out.normal
        .set(
          p.wa * nrm.getX(p.ia) + p.wb * nrm.getX(p.ib) + p.wc * nrm.getX(p.ic),
          p.wa * nrm.getY(p.ia) + p.wb * nrm.getY(p.ib) + p.wc * nrm.getY(p.ic),
          p.wa * nrm.getZ(p.ia) + p.wb * nrm.getZ(p.ib) + p.wc * nrm.getZ(p.ic),
        )
        .normalize()
    } else {
      // No normal attribute: face normal from the live triangle. Front-face
      // winding (CCW) makes this point out of the rendered side.
      _a.set(pos.getX(p.ia), pos.getY(p.ia), pos.getZ(p.ia))
      _ab.set(pos.getX(p.ib), pos.getY(p.ib), pos.getZ(p.ib)).sub(_a)
      _ac.set(pos.getX(p.ic), pos.getY(p.ic), pos.getZ(p.ic)).sub(_a)
      out.normal.crossVectors(_ab, _ac).normalize()
    }

    return out
  }
}

/** One-shot convenience: resolve and sample in a single call. */
export function sampleSurfaceAtUV(
  geometry: THREE.BufferGeometry,
  u: number,
  v: number,
  target?: SurfaceSample,
): SurfaceSample | null {
  return new UVAnchor(geometry, u, v).sample(target)
}
