/**
 * Text Templates — plantillas de texto reutilizables guardadas en localStorage
 */

const STORAGE_KEY = 'ommex_text_templates'

export interface TextTemplate {
  id: string
  text: string
  usedCount: number
  createdAt: number
}

export function getTemplates(): TextTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function saveTemplate(text: string): TextTemplate {
  const templates = getTemplates()
  // Si ya existe, incrementar uso
  const existing = templates.find((t) => t.text === text)
  if (existing) {
    existing.usedCount++
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
    return existing
  }
  // Crear nueva
  const template: TextTemplate = {
    id: `tpl-${Date.now()}`,
    text,
    usedCount: 1,
    createdAt: Date.now(),
  }
  templates.unshift(template)
  // Máximo 50 plantillas
  if (templates.length > 50) templates.pop()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
  return template
}

export function deleteTemplate(id: string): void {
  const templates = getTemplates().filter((t) => t.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
}

export function getFrequentTemplates(limit = 10): TextTemplate[] {
  return getTemplates()
    .sort((a, b) => b.usedCount - a.usedCount)
    .slice(0, limit)
}
