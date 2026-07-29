import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { UVAnchor, sampleSurfaceAtUV } from './uvAnchor'

// The contract under test: given a BufferGeometry and a (u, v) texture
// coordinate, find the point ON the geometry's surface that the texture maps
// to — position and normal, in local space, read from the LIVE attributes so
// deforming geometry keeps anchors glued to its skin.

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

describe('sampleSurfaceAtUV on PlaneGeometry', () => {
  // three's PlaneGeometry maps u: 0→1 across x ∈ [-w/2, w/2] and
  // v: 0→1 across y ∈ [-h/2, h/2] (v=1 at the top). Linear mapping, so the
  // sampled position must match the closed form exactly.
  it('matches the closed-form linear mapping', () => {
    const geo = new THREE.PlaneGeometry(2, 1, 4, 4)
    const s = sampleSurfaceAtUV(geo, 0.25, 0.75)
    expect(s).not.toBeNull()
    expect(close(s!.position.x, (0.25 - 0.5) * 2)).toBe(true)
    expect(close(s!.position.y, (0.75 - 0.5) * 1)).toBe(true)
    expect(close(s!.position.z, 0)).toBe(true)
    expect(close(s!.normal.z, 1)).toBe(true)
  })

  it('handles exact corners and edges of UV space', () => {
    const geo = new THREE.PlaneGeometry(2, 2, 3, 3)
    for (const [u, v] of [[0, 0], [1, 1], [0, 1], [1, 0], [0.5, 0], [0, 0.5]]) {
      const s = sampleSurfaceAtUV(geo, u, v)
      expect(s, `uv(${u},${v})`).not.toBeNull()
      expect(close(s!.position.x, (u - 0.5) * 2)).toBe(true)
      expect(close(s!.position.y, (v - 0.5) * 2)).toBe(true)
    }
  })

  it('returns null outside the geometry UV coverage', () => {
    const geo = new THREE.PlaneGeometry(1, 1)
    expect(sampleSurfaceAtUV(geo, 1.5, 0.5)).toBeNull()
    expect(sampleSurfaceAtUV(geo, -0.1, 0.5)).toBeNull()
    expect(sampleSurfaceAtUV(geo, 0.5, 1.2)).toBeNull()
  })

  it('works on non-indexed geometry too', () => {
    const geo = new THREE.PlaneGeometry(2, 1, 4, 4).toNonIndexed()
    const s = sampleSurfaceAtUV(geo, 0.25, 0.75)
    expect(s).not.toBeNull()
    expect(close(s!.position.x, -0.5)).toBe(true)
    expect(close(s!.position.y, 0.25)).toBe(true)
  })
})

describe('sampleSurfaceAtUV on CylinderGeometry (curved surface)', () => {
  const R = 1.5
  const H = 2
  const geo = new THREE.CylinderGeometry(R, R, H, 32, 4, true)

  it('sampled points lie on the cylinder shell with outward normals', () => {
    for (const [u, v] of [[0.1, 0.2], [0.4, 0.5], [0.8, 0.9], [0.5, 0.5]]) {
      const s = sampleSurfaceAtUV(geo, u, v)
      expect(s, `uv(${u},${v})`).not.toBeNull()
      const radial = Math.hypot(s!.position.x, s!.position.z)
      // Chordal shrink: the sampled point sits on a flat triangle between
      // ring vertices, slightly inside the true radius — allow that much.
      expect(radial).toBeGreaterThan(R * 0.98)
      expect(radial).toBeLessThanOrEqual(R + 1e-6)
      // v maps linearly along height, v=1 at the top
      expect(close(s!.position.y, (v - 0.5) * H, 1e-6)).toBe(true)
      // normal points radially outward
      const out = new THREE.Vector3(s!.position.x, 0, s!.position.z).normalize()
      expect(s!.normal.dot(out)).toBeGreaterThan(0.98)
      expect(close(s!.normal.length(), 1, 1e-3)).toBe(true)
    }
  })

  it('u and u+0.5 are antipodal around the axis', () => {
    const a = sampleSurfaceAtUV(geo, 0.2, 0.5)!
    const b = sampleSurfaceAtUV(geo, 0.7, 0.5)!
    expect(close(a.position.x, -b.position.x, 1e-6)).toBe(true)
    expect(close(a.position.z, -b.position.z, 1e-6)).toBe(true)
  })

  it('both sides of the UV seam (u=0 and u=1) resolve to the same point', () => {
    const a = sampleSurfaceAtUV(geo, 0, 0.5)
    const b = sampleSurfaceAtUV(geo, 1, 0.5)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(a!.position.distanceTo(b!.position)).toBeLessThan(1e-6)
  })
})

describe('UVAnchor on deforming geometry', () => {
  // The topology lookup (which triangle, which barycentric weights) depends
  // only on the UV attribute, which never changes — so it's resolved once in
  // the constructor. sample() re-reads the LIVE position/normal attributes,
  // so a CPU-displaced mesh carries its anchors with it.
  const displace = (geo: THREE.BufferGeometry, f: (x: number, y: number) => number) => {
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, f(pos.getX(i), pos.getY(i)))
    }
    pos.needsUpdate = true
  }

  it('tracks a linear displacement exactly via cached barycentric weights', () => {
    const geo = new THREE.PlaneGeometry(2, 2, 8, 8)
    const anchor = new UVAnchor(geo, 0.7, 0.3)
    expect(anchor.valid).toBe(true)

    const flat = anchor.sample()!
    expect(close(flat.position.z, 0)).toBe(true)

    // z = 0.5x + 1 is linear, so barycentric interpolation reproduces it
    // exactly at any sampled point.
    displace(geo, (x) => 0.5 * x + 1)
    const bent = anchor.sample()!
    expect(close(bent.position.x, 0.4)).toBe(true)
    expect(close(bent.position.y, -0.4)).toBe(true)
    expect(close(bent.position.z, 0.5 * 0.4 + 1)).toBe(true)
  })

  it('interpolates recomputed vertex normals after deformation', () => {
    const geo = new THREE.PlaneGeometry(2, 2, 8, 8)
    const anchor = new UVAnchor(geo, 0.7, 0.3)
    displace(geo, (x) => 0.5 * x + 1)
    geo.computeVertexNormals()
    const s = anchor.sample()!
    // The tilted plane z = 0.5x + 1 has normal ∝ (-0.5, 0, 1).
    const expected = new THREE.Vector3(-0.5, 0, 1).normalize()
    expect(s.normal.dot(expected)).toBeGreaterThan(0.999)
    expect(close(s.normal.length(), 1, 1e-3)).toBe(true)
  })

  it('falls back to a live face normal when the geometry has no normal attribute', () => {
    const geo = new THREE.PlaneGeometry(2, 2, 8, 8)
    geo.deleteAttribute('normal')
    const anchor = new UVAnchor(geo, 0.7, 0.3)
    displace(geo, (x) => 0.5 * x + 1)
    const s = anchor.sample()!
    const expected = new THREE.Vector3(-0.5, 0, 1).normalize()
    expect(s.normal.dot(expected)).toBeGreaterThan(0.999)
  })

  it('is invalid (and samples null) for uncovered UV coords', () => {
    const geo = new THREE.PlaneGeometry(1, 1)
    const anchor = new UVAnchor(geo, 2, 2)
    expect(anchor.valid).toBe(false)
    expect(anchor.sample()).toBeNull()
  })

  it('writes into a caller-provided target without allocating', () => {
    const geo = new THREE.PlaneGeometry(1, 1)
    const anchor = new UVAnchor(geo, 0.5, 0.5)
    const target = { position: new THREE.Vector3(), normal: new THREE.Vector3() }
    const out = anchor.sample(target)
    expect(out).toBe(target)
    expect(close(target.position.x, 0)).toBe(true)
  })
})
