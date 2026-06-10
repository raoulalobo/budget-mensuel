import { parseAmount } from '../csv'
import type { ParsedEntry, SectionRef } from '../csv'
import type { ImportMapping, SectionStrategy } from './types'

/**
 * Application DÉTERMINISTE d'un `ImportMapping` (produit par l'IA ou par le
 * repli manuel) à TOUTES les lignes d'un fichier.
 *
 * Fonction PURE (aucun accès réseau/état) — c'est le cœur testable du pipeline :
 * l'IA ne voit qu'un échantillon, ce code applique sa "recette" au fichier entier.
 *
 * Exemple :
 *   applyMapping(
 *     [["Poste","Montant"],["Loyer","800 €"],["TOTAL","800"]],
 *     { headerRows: 1, labelColumn: 0, budgetColumn: null, realColumn: 1,
 *       singleAmountTarget: 'both', section: { type: 'fixed', key: 'fixed' },
 *       skipRowIndexes: [], ignoreLabelContains: ['total'], signConvention: 'absolute' },
 *     sections,
 *   )
 *   // → { entries: [{ section:'fixed', label:'Loyer', budget:800, real:800 }],
 *   //     errors: [], skipped: 1 }
 */
export interface ApplyResult {
  /** Lignes prêtes pour `budget.importEntries`. */
  entries: ParsedEntry[]
  /** Problèmes rencontrés, ligne par ligne (libellé vide, montant illisible…). */
  errors: string[]
  /** Nombre de lignes ignorées volontairement (en-têtes, totaux, skip explicites). */
  skipped: number
}

/** Normalise une valeur de catégorie pour le `valueMap` (casse/espaces). */
function normKey(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * Vérifie qu'un mapping est applicable au tableau donné : index de colonnes
 * dans les bornes, clés de rubrique existantes, fallback présent.
 * Retourne la liste des problèmes (vide si le mapping est valide).
 */
export function validateMapping(
  mapping: ImportMapping,
  columnCount: number,
  sections: SectionRef[],
): string[] {
  const problems: string[] = []
  const keys = new Set(sections.map((s) => s.key))
  const colOk = (c: number) => Number.isInteger(c) && c >= 0 && c < columnCount

  if (!colOk(mapping.labelColumn))
    problems.push(`Colonne libellé invalide (${mapping.labelColumn}).`)
  if (mapping.budgetColumn !== null && !colOk(mapping.budgetColumn))
    problems.push(`Colonne « prévu » invalide (${mapping.budgetColumn}).`)
  if (mapping.realColumn !== null && !colOk(mapping.realColumn))
    problems.push(`Colonne « réel » invalide (${mapping.realColumn}).`)
  if (mapping.budgetColumn === null && mapping.realColumn === null)
    problems.push('Aucune colonne de montant définie.')
  if (!Number.isInteger(mapping.headerRows) || mapping.headerRows < 0)
    problems.push(`Nombre de lignes d'en-tête invalide (${mapping.headerRows}).`)

  const s = mapping.section
  if (s.type === 'fixed') {
    if (!keys.has(s.key)) problems.push(`Rubrique inconnue « ${s.key} ».`)
  } else {
    if (!keys.has(s.fallback))
      problems.push(`Rubrique de repli inconnue « ${s.fallback} ».`)
    if (s.type === 'column') {
      if (!colOk(s.column))
        problems.push(`Colonne de catégorie invalide (${s.column}).`)
      for (const key of Object.values(s.valueMap))
        if (!keys.has(key)) problems.push(`Rubrique inconnue « ${key} » dans le mapping de catégories.`)
    } else {
      for (const r of s.rules) {
        if (!colOk(r.column)) problems.push(`Colonne de règle invalide (${r.column}).`)
        if (!keys.has(r.key)) problems.push(`Rubrique inconnue « ${r.key} » dans une règle.`)
      }
    }
  }
  return problems
}

/** Résout la rubrique d'une ligne selon la stratégie du mapping. */
function resolveSection(strategy: SectionStrategy, row: string[]): string {
  switch (strategy.type) {
    case 'fixed':
      return strategy.key
    case 'column': {
      const cell = normKey(row[strategy.column] ?? '')
      // valueMap est consulté en clé normalisée (l'action normalise déjà,
      // on renormalise ici par défense en profondeur).
      for (const [val, key] of Object.entries(strategy.valueMap)) {
        if (normKey(val) === cell) return key
      }
      return strategy.fallback
    }
    case 'rules': {
      for (const rule of strategy.rules) {
        const cell = (row[rule.column] ?? '').toLowerCase()
        if (cell.includes(rule.contains.toLowerCase())) return rule.key
      }
      return strategy.fallback
    }
  }
}

/**
 * Applique le mapping à toutes les lignes du tableau.
 *
 * Conventions reprises de l'import historique (src/lib/csv.ts) :
 *  - montant "réel" absent → réel = prévu ;
 *  - montant illisible → 0 + erreur listée (la ligne reste corrigeable dans l'aperçu) ;
 *  - libellé vide → ligne exclue + erreur.
 */
export function applyMapping(
  table: string[][],
  mapping: ImportMapping,
  sections: SectionRef[],
): ApplyResult {
  const errors: string[] = []
  const entries: ParsedEntry[] = []
  let skipped = 0

  const columnCount = table.reduce((max, r) => Math.max(max, r.length), 0)
  const problems = validateMapping(mapping, columnCount, sections)
  if (problems.length > 0) {
    return { entries: [], errors: problems, skipped: 0 }
  }

  const skipSet = new Set(mapping.skipRowIndexes)
  const ignoreFragments = mapping.ignoreLabelContains
    .map((f) => f.trim().toLowerCase())
    .filter((f) => f.length > 0)

  table.forEach((row, i) => {
    // 1) Lignes volontairement ignorées : en-têtes, lignes pointées par l'IA.
    if (i < mapping.headerRows || skipSet.has(i)) {
      skipped++
      return
    }
    // 2) Lignes vides : toujours ignorées (sans bruit dans les erreurs).
    if (row.every((c) => c.trim().length === 0)) {
      skipped++
      return
    }

    const label = (row[mapping.labelColumn] ?? '').trim()

    // 3) Filtre déterministe des totaux/sous-totaux sur tout le fichier.
    const labelLower = label.toLowerCase()
    if (ignoreFragments.some((f) => labelLower.includes(f))) {
      skipped++
      return
    }

    if (!label) {
      errors.push(`Ligne ${i + 1} : libellé manquant — ligne exclue.`)
      return
    }

    /** Lit un montant dans une cellule : "1 234,56 €" → 1234.56 (0 si illisible). */
    const readAmount = (col: number): number => {
      const raw = (row[col] ?? '').trim()
      const n = parseAmount(raw)
      // parseAmount renvoie 0 sur l'illisible : on signale seulement si la
      // cellule était non vide ET non numérique (vide = vrai zéro voulu).
      if (raw !== '' && n === 0 && !/^[-+]?0+([.,]0*)?$/.test(raw.replace(/[€$\s ]/g, ''))) {
        errors.push(`Ligne ${i + 1} : montant illisible « ${raw} » (mis à 0).`)
      }
      return mapping.signConvention === 'negative-is-expense' ? Math.abs(n) : n
    }

    // 4) Montants : deux colonnes distinctes, ou colonne unique ventilée
    //    selon `singleAmountTarget`.
    let budget = 0
    let real = 0
    if (mapping.budgetColumn !== null && mapping.realColumn !== null) {
      budget = readAmount(mapping.budgetColumn)
      real = readAmount(mapping.realColumn)
    } else {
      const only = (mapping.budgetColumn ?? mapping.realColumn) as number
      const amount = readAmount(only)
      if (mapping.singleAmountTarget === 'budget') {
        budget = amount
        // Convention historique : réel absent → réel = prévu.
        real = amount
      } else if (mapping.singleAmountTarget === 'real') {
        real = amount
      } else {
        budget = amount
        real = amount
      }
    }

    entries.push({
      section: resolveSection(mapping.section, row),
      label,
      budget,
      real,
    })
  })

  return { entries, errors, skipped }
}
