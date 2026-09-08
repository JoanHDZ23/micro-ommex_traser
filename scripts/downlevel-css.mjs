// Post-procesa los CSS del build para que funcionen en navegadores/WebView
// antiguos (Chrome <99, sin soporte de cascade layers @layer).
// 1) lightningcss degrada color-mix(), nesting, etc. a fallbacks.
// 2) Desenvuelve los bloques @layer (no soportados por Chrome <99) al nivel raíz,
//    manteniendo el orden de la cascada tal como los emite Tailwind v4.
// 3) Elimina reglas @property (Chrome <85) — solo definen valores iniciales de
//    custom properties que ya tienen fallback en las utilidades.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { transform, browserslistToTargets } from 'lightningcss'
import browserslist from 'browserslist'

const targets = browserslistToTargets(
  browserslist(['chrome >= 87', 'safari >= 13', 'firefox >= 78', 'edge >= 88', 'ios_saf >= 13', 'android >= 87']),
)

/** Elimina bloques at-rule con nombre (p.ej. @property ...) balanceando llaves */
function stripAtRuleBlocks(css, atRuleName) {
  const marker = `@${atRuleName}`
  let out = ''
  let i = 0
  while (i < css.length) {
    const idx = css.indexOf(marker, i)
    if (idx === -1) { out += css.slice(i); break }
    out += css.slice(i, idx)
    // avanzar hasta la primera '{' y balancear
    let j = css.indexOf('{', idx)
    if (j === -1) { out += css.slice(idx); break }
    let depth = 1
    j++
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      j++
    }
    i = j // saltar el bloque completo
  }
  return out
}

/** Desenvuelve `@layer nombre { ... }` sacando el contenido al nivel raíz */
function unwrapLayers(css) {
  // Eliminar declaraciones de orden de capas: `@layer a, b, c;` y `@layer nombre;`
  css = css.replace(/@layer[^{;]*;/g, '')

  let out = ''
  let i = 0
  const marker = '@layer'
  while (i < css.length) {
    const idx = css.indexOf(marker, i)
    if (idx === -1) { out += css.slice(i); break }
    out += css.slice(i, idx)
    const braceStart = css.indexOf('{', idx)
    if (braceStart === -1) { out += css.slice(idx); break }
    // balancear para hallar el cierre del bloque @layer
    let depth = 1
    let j = braceStart + 1
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      j++
    }
    // contenido interior (sin las llaves externas del @layer)
    const inner = css.slice(braceStart + 1, j - 1)
    out += inner
    i = j
  }
  return out
}

const assetsDir = join(process.cwd(), 'dist', 'assets')
const cssFiles = readdirSync(assetsDir).filter((f) => f.endsWith('.css'))

for (const file of cssFiles) {
  const full = join(assetsDir, file)
  let css = readFileSync(full, 'utf8')

  // 1) Desenvolver @layer (recursivo por si hay anidados) y quitar @property
  let prev
  do { prev = css; css = unwrapLayers(css) } while (css !== prev && css.includes('@layer'))
  css = stripAtRuleBlocks(css, 'property')

  // 2) lightningcss: fallbacks de color-mix, nesting, prefijos y minificado
  const { code } = transform({
    filename: file,
    code: Buffer.from(css),
    minify: true,
    targets,
  })
  writeFileSync(full, code)
  console.log(`[downlevel-css] procesado ${file}`)
}
