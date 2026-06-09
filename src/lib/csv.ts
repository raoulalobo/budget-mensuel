import type { Section } from './budget'

/**
 * Utilitaires d'import CSV/TSV pour les lignes de budget.
 *
 * Format accepté (un séparateur parmi tabulation, `;` ou `,`, détecté
 * automatiquement) :
 *
 *   - 4 colonnes : `Section ; Libellé ; Prévu ; Réel`
 *   - 3 colonnes : `Libellé ; Prévu ; Réel`  (si une section est imposée)
 *
 * Les montants tolèrent le format français : espaces, symbole €, virgule
 * décimale. Exemple : "1 234,56 €" → 1234.56.
 */

/** Une ligne de budget prête à être importée. */
export interface ParsedEntry {
  section: Section
  label: string
  budget: number
  real: number
}

/** Résultat du parsing : lignes valides + erreurs ligne par ligne. */
export interface ParseResult {
  rows: ParsedEntry[]
  errors: string[]
}

/**
 * Convertit un montant écrit "à la française" en nombre.
 * "1 234,56 €" → 1234.56 ; "" → 0 ; "10.5" → 10.5
 */
export function parseAmount(raw: string): number {
  if (!raw) return 0
  let s = raw.trim().replace(/[€$\s ]/g, '') // retire devises et espaces (y compris insécables)
  if (!s) return 0
  // S'il y a une virgule, on la considère comme séparateur décimal.
  if (s.includes(',')) {
    s = s.replace(/\./g, '') // retire les séparateurs de milliers éventuels
    s = s.replace(',', '.')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/** Une rubrique connue (pour matcher une colonne « Section » d'un CSV). */
export interface SectionRef {
  key: string
  label: string
}

/**
 * Alias historiques (FR/EN) vers les clés des rubriques par défaut. Sert de
 * repli quand le nom du CSV ne correspond pas exactement à un libellé existant.
 */
const SECTION_ALIASES: Record<string, string> = {
  revenus: 'income',
  revenu: 'income',
  salaire: 'income',
  salaires: 'income',
  income: 'income',
  depensesfixes: 'fixed',
  fixe: 'fixed',
  fixes: 'fixed',
  fixed: 'fixed',
  depensesvariables: 'variable',
  variable: 'variable',
  variables: 'variable',
  credit: 'credit',
  credits: 'credit',
  epargne: 'saving',
  saving: 'saving',
  savings: 'saving',
}

/** Normalise une chaîne (minuscule, sans accent ni caractère non alphanumérique). */
function norm(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Résout un nom de section vers une clé de rubrique : d'abord par correspondance
 * exacte avec le LIBELLÉ d'une rubrique existante (ou sa clé), sinon via les
 * alias standard (en vérifiant que la clé existe parmi les rubriques fournies).
 */
function normalizeSection(raw: string, sections: SectionRef[]): string | null {
  const n = norm(raw)
  if (!n) return null
  for (const s of sections) {
    if (norm(s.label) === n || norm(s.key) === n) return s.key
  }
  const alias = SECTION_ALIASES[n]
  if (alias && sections.some((s) => s.key === alias)) return alias
  return null
}

/** Choisit le séparateur d'une ligne : tabulation > point-virgule > virgule. */
function detectDelimiter(line: string): string {
  if (line.includes('\t')) return '\t'
  if (line.includes(';')) return ';'
  return ','
}

/**
 * Parse un texte CSV/TSV en lignes de budget.
 *
 * @param text          contenu collé ou lu depuis un fichier
 * @param forcedSection si défini, toutes les lignes vont dans cette section et
 *                      le format attendu est `Libellé ; Prévu ; Réel`
 */
export function parseBudgetCsv(
  text: string,
  forcedSection?: string,
  sections: SectionRef[] = [],
): ParseResult {
  const rows: ParsedEntry[] = []
  const errors: string[] = []

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  lines.forEach((line, i) => {
    const delim = detectDelimiter(line)
    const cells = line.split(delim).map((c) => c.trim())

    // Ignore une éventuelle ligne d'en-tête.
    const first = cells[0]?.toLowerCase()
    if (
      first === 'section' ||
      first === 'poste' ||
      first === 'libellé' ||
      first === 'libelle'
    ) {
      return
    }

    let section: string | null
    let label: string
    let budgetCell: string | undefined
    let realCell: string | undefined

    if (forcedSection) {
      // Format 3 colonnes : Libellé ; Prévu ; Réel
      section = forcedSection
      label = cells[0] ?? ''
      budgetCell = cells[1]
      realCell = cells[2]
    } else {
      // Format 4 colonnes : Section ; Libellé ; Prévu ; Réel
      section = normalizeSection(cells[0] ?? '', sections)
      label = cells[1] ?? ''
      budgetCell = cells[2]
      realCell = cells[3]
      if (!section) {
        errors.push(`Ligne ${i + 1} : section inconnue « ${cells[0]} »`)
        return
      }
    }

    if (!label) {
      errors.push(`Ligne ${i + 1} : libellé manquant`)
      return
    }

    const budget = parseAmount(budgetCell ?? '')
    // Si la colonne "réel" est absente, on reprend le montant prévu.
    const real = realCell === undefined ? budget : parseAmount(realCell)

    rows.push({ section, label, budget, real })
  })

  return { rows, errors }
}
