import type { Section } from './budget'

/**
 * Types et utilitaires partagés par les flux d'import (import intelligent,
 * import par photo). Le parsing CSV/Excel lui-même vit dans
 * `src/lib/smartImport/parseFile.ts`.
 */

/** Une ligne de budget prête à être importée (format de `budget.importEntries`). */
export interface ParsedEntry {
  section: Section
  label: string
  budget: number
  real: number
  /** Date optionnelle (ISO 'YYYY-MM-DD'), si une colonne date a été mappée. */
  date?: string
}

/** Résultat d'un parsing : lignes valides + erreurs ligne par ligne. */
export interface ParseResult {
  rows: ParsedEntry[]
  errors: string[]
}

/** Une rubrique connue (clé + libellé), pour valider un mapping d'import. */
export interface SectionRef {
  key: string
  label: string
}

/**
 * Convertit un montant écrit "à la française" en nombre.
 * "1 234,56 €" → 1234.56 ; "" → 0 ; "10.5" → 10.5
 */
export function parseAmount(raw: string): number {
  if (!raw) return 0
  let s = raw.trim().replace(/[€$\s ]/g, '') // retire devises et espaces (y compris insécables)
  if (!s) return 0
  // S'il y a une virgule, on la considère comme séparateur décimal.
  if (s.includes(',')) {
    s = s.replace(/\./g, '') // retire les séparateurs de milliers éventuels
    s = s.replace(',', '.')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/**
 * Convertit une date écrite dans un format courant en ISO `YYYY-MM-DD`.
 * Repli `undefined` si illisible (cellule vide, texte non-date…).
 *
 * Gère : "2025-01-15" (ISO), "15/01/2025" et "15-01-2025" (jour d'abord, FR),
 * et l'année sur 2 chiffres ("15/01/25" → 2025). Les valeurs ambiguës ou
 * impossibles (mois > 12, jour > 31) renvoient `undefined`.
 * Exemples : parseDate("15/01/2025") => "2025-01-15" ; parseDate("") => undefined.
 */
export function parseDate(raw: string): string | undefined {
  if (!raw) return undefined
  const s = raw.trim()
  if (!s) return undefined

  // Déjà ISO (avec éventuelle partie heure qu'on ignore).
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const [, y, m, d] = iso
    return buildISO(Number(y), Number(m), Number(d))
  }

  // Format "jour séparateur mois séparateur année" (FR), séparateur / . ou -.
  const fr = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (fr) {
    const day = Number(fr[1])
    const month = Number(fr[2])
    let year = Number(fr[3])
    if (year < 100) year += 2000 // "25" → 2025
    return buildISO(year, month, day)
  }

  return undefined
}

/** Assemble une date ISO valide à partir de (année, mois, jour) ; undefined si impossible. */
function buildISO(year: number, month: number, day: number): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  const candidate = `${year}-${mm}-${dd}`
  // Vérifie que la date existe réellement (rejette 31/02, etc.).
  const dt = new Date(`${candidate}T12:00:00`)
  if (Number.isNaN(dt.getTime()) || dt.getDate() !== day) return undefined
  return candidate
}
