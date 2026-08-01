import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// The library/consumer boundary, enforced.
//
// `src/` is three-ui; `app/` is a lab application that consumes it. The split
// is only worth anything if it cannot quietly erode, and it erodes in exactly
// two ways: the library reaching down into the app for something convenient,
// or a scene reaching past the barrel on a relative path and never noticing
// that the export it wanted was never public.
//
// Both are one grep, so they may as well be a test.

const ROOT = join(import.meta.dirname, '..')

function sources(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) sources(p, acc)
    else if (/\.tsx?$/.test(e.name)) acc.push(p)
  }
  return acc
}

/** Every module specifier in a file, from static imports, `export … from`, and dynamic `import()`. */
function specifiers(code: string): string[] {
  const out: string[] = []
  const re = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g
  for (const m of code.matchAll(re)) out.push(m[1])
  return out
}

const rel = (p: string) => p.slice(ROOT.length + 1)

describe('library / app boundary', () => {
  it('nothing in src/ imports from app/', () => {
    const offenders: string[] = []
    for (const file of sources(join(ROOT, 'src'))) {
      for (const s of specifiers(readFileSync(file, 'utf8'))) {
        // `@/…` is the app's own alias; `../app/…` is the blunt version.
        if (s.startsWith('@/') || /(^|\/)app\//.test(s)) {
          offenders.push(`${rel(file)} → ${s}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('nothing in app/ reaches into src/ except through the barrel', () => {
    const offenders: string[] = []
    for (const file of sources(join(ROOT, 'app'))) {
      for (const s of specifiers(readFileSync(file, 'utf8'))) {
        // `three-ui` and `three-ui/style.css` are the public door. A relative
        // path climbing out of app/ into src/ is not.
        if (/(^|\/)(src|primitives|lib\/htmlInCanvas)\//.test(s) && !s.startsWith('@/')) {
          offenders.push(`${rel(file)} → ${s}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('every specifier starting with three-ui is one the aliases define', () => {
    const allowed = new Set(['three-ui', 'three-ui/style.css'])
    const offenders: string[] = []
    for (const file of sources(join(ROOT, 'app'))) {
      for (const s of specifiers(readFileSync(file, 'utf8'))) {
        if (s.startsWith('three-ui') && !allowed.has(s)) {
          offenders.push(`${rel(file)} → ${s}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
