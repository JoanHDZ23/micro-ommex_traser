/**
 * github-storage.ts
 * -----------------------------------------------------------------------------
 * Sube imágenes a un repositorio público de GitHub usando la API REST (fetch,
 * sin dependencias extra) y devuelve la URL pública directa en formato
 * raw.githubusercontent.com, lista para enviarse como media por WhatsApp.
 *
 * ⚠️ GitHub NO es un servicio de almacenamiento de archivos. Las imágenes quedan
 * públicas y permanentes en el historial de git. Úsalo para pruebas / bajo
 * volumen; para producción usa el object storage R2 (lib/storage.ts).
 *
 * Variables de entorno:
 *   GITHUB_TOKEN   - Personal Access Token (fine-grained con Contents: Read&Write)
 *   GITHUB_OWNER   - usuario/organización dueña del repo (ej. maguisuser02-eng)
 *   GITHUB_REPO    - repo público destino (ej. Data-img)
 *   GITHUB_BRANCH  - rama (opcional, default main)
 */

import { randomUUID } from 'node:crypto'

const OWNER = () => process.env.GITHUB_OWNER ?? ''
const REPO = () => process.env.GITHUB_REPO ?? ''
const BRANCH = () => process.env.GITHUB_BRANCH ?? 'main'
const TOKEN = () => process.env.GITHUB_TOKEN ?? ''

export function isGitHubConfigured(): boolean {
  return Boolean(TOKEN() && OWNER() && REPO())
}

export interface GitHubUploadResult {
  path: string
  rawUrl: string
  htmlUrl: string
  sha: string
}

/** Normaliza Buffer o base64 (con/sin data URL) a base64 "puro". */
function toBase64(input: string | Buffer): string {
  if (Buffer.isBuffer(input)) return input.toString('base64')
  return input.includes(',') ? input.slice(input.indexOf(',') + 1) : input
}

/**
 * Sube una imagen a GitHub y devuelve su información pública.
 * @param image  Buffer o string base64.
 * @param opts   path (carpeta lógica), fileName, ext, message (commit).
 */
export async function uploadImageToGitHub(
  image: string | Buffer,
  opts: { path?: string; fileName?: string; ext?: string; message?: string } = {},
): Promise<GitHubUploadResult> {
  if (!isGitHubConfigured()) {
    throw new Error('GitHub no configurado. Define GITHUB_TOKEN, GITHUB_OWNER y GITHUB_REPO.')
  }

  const base64 = toBase64(image)
  const ext = (opts.ext || 'jpg').replace(/^\./, '')
  const fileName = (opts.fileName || `${randomUUID()}.${ext}`).replace(/[^a-zA-Z0-9._-]/g, '_')
  const dir = (opts.path || 'uploads').replace(/^\/+|\/+$/g, '')
  const repoPath = `${dir}/${fileName}`

  const apiUrl = `https://api.github.com/repos/${OWNER()}/${REPO()}/contents/${repoPath}`
  const resp = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${TOKEN()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: opts.message || `chore: subir ${repoPath}`,
      content: base64,
      branch: BRANCH(),
    }),
    signal: AbortSignal.timeout(60_000),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`GitHub respondió ${resp.status}: ${text.slice(0, 200)}`)
  }

  const data = await resp.json() as { content?: { html_url?: string; sha?: string } }
  const rawUrl = `https://raw.githubusercontent.com/${OWNER()}/${REPO()}/${BRANCH()}/${repoPath}`

  return {
    path: repoPath,
    rawUrl,
    htmlUrl: data.content?.html_url ?? '',
    sha: data.content?.sha ?? '',
  }
}
