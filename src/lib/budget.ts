/**
 * Helpers partagés du domaine "budget".
 *
 * Ce module centralise tout ce qui touche à la présentation des données
 * budgétaires : noms des mois en français, libellés des sections, formatage
 * monétaire (€, format français) et calcul des totaux d'un mois.
 *
 * Il est volontairement sans dépendance à React ou Convex pour pouvoir être
 * utilisé partout (composants, tests, seed...).
 */

/** Les 4 grandes sections de dépenses + l'épargne, dans l'ordre d'affichage. */
export const SECTIONS = [
  'income',
  'fixed',
  'variable',
  'credit',
  'saving',
] as const

export type Section = (typeof SECTIONS)[number]

/** Libellé humain (FR) de chaque section. */
export const SECTION_LABELS: Record<Section, string> = {
  income: 'Revenus',
  fixed: 'Dépenses fixes',
  variable: 'Dépenses variables',
  credit: 'Crédits',
  saving: 'Épargne',
}

/** Couleur d'accent associée à chaque section (utilisée par les graphiques). */
export const SECTION_COLORS: Record<Section, string> = {
  income: '#16a34a', // vert  — entrées d'argent
  fixed: '#2563eb', // bleu   — charges récurrentes
  variable: '#f59e0b', // ambre — dépenses pilotables
  credit: '#dc2626', // rouge  — crédits
  saving: '#7c3aed', // violet — épargne
}

/** Les sections considérées comme des "sorties d'argent" (dépenses). */
export const EXPENSE_SECTIONS: Section[] = ['fixed', 'variable', 'credit', 'saving']

/** Noms des 12 mois en français, indexés de 1 (Janvier) à 12 (Décembre). */
export const MONTH_NAMES = [
  '',
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
] as const

/** Renvoie le nom français d'un mois (1-12). */
export function monthName(month: number): string {
  return MONTH_NAMES[month] ?? `Mois ${month}`
}

/**
 * Formate un nombre en euros, format français.
 * Exemple : formatEUR(6043.4) => "6 043,40 €"
 */
const eurFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
export function formatEUR(value: number): string {
  return eurFormatter.format(value ?? 0)
}

/** Forme minimale d'une ligne de budget pour les calculs (sous-ensemble du doc Convex). */
export interface EntryLike {
  section: Section
  budget: number
  real: number
}

/** Résumé chiffré d'un mois : totaux Revenus / Dépenses / NET, en prévu et réel. */
export interface MonthSummary {
  incomeBudget: number
  incomeReal: number
  expenseBudget: number
  expenseReal: number
  netBudget: number
  netReal: number
}

/**
 * Calcule le résumé d'un mois à partir de ses lignes.
 *
 * - Revenus  = somme des lignes `income`
 * - Dépenses = somme des lignes fixed + variable + credit + saving
 * - NET      = Revenus − Dépenses
 *
 * Exemple : 2 500 € de revenus − 2 000 € de dépenses → netReal = 500 €.
 */
export function computeSummary(entries: EntryLike[]): MonthSummary {
  let incomeBudget = 0
  let incomeReal = 0
  let expenseBudget = 0
  let expenseReal = 0

  for (const e of entries) {
    if (e.section === 'income') {
      incomeBudget += e.budget
      incomeReal += e.real
    } else {
      expenseBudget += e.budget
      expenseReal += e.real
    }
  }

  return {
    incomeBudget,
    incomeReal,
    expenseBudget,
    expenseReal,
    netBudget: incomeBudget - expenseBudget,
    netReal: incomeReal - expenseReal,
  }
}

/** Total (budget + réel) d'un sous-ensemble de lignes — pratique pour un en-tête de section. */
export function sectionTotals(entries: EntryLike[], section: Section) {
  return entries
    .filter((e) => e.section === section)
    .reduce(
      (acc, e) => ({ budget: acc.budget + e.budget, real: acc.real + e.real }),
      { budget: 0, real: 0 },
    )
}
