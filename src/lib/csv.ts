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
