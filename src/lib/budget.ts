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

/**
 * Clé d'une RUBRIQUE (section). Les rubriques sont désormais DYNAMIQUES
 * (personnalisables par l'utilisateur) : la clé est une simple chaîne. Les
 * libellés / couleurs / type (Revenu vs Dépense) sont fournis par la table
 * `sections` (cf. `src/lib/useSections.ts` côté client).
 */
export type Section = string

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
 * DEVISES proposées dans l'interface (code ISO 4217 + libellé affiché).
 *
 * Un budget = UNE seule devise (pas de conversion). Cette liste alimente le
 * sélecteur de la page Profil et DOIT rester synchronisée avec la validation
 * serveur `ALLOWED_CURRENCIES` (cf. convex/settings.ts).
 */
export const CURRENCIES = [
  { code: 'EUR', label: 'Euro (€)' },
  { code: 'USD', label: 'Dollar US ($)' },
  { code: 'XAF', label: 'Franc CFA BEAC (FCFA)' },
  { code: 'XOF', label: 'Franc CFA BCEAO (FCFA)' },
  { code: 'GBP', label: 'Livre sterling (£)' },
  { code: 'CHF', label: 'Franc suisse (CHF)' },
  { code: 'CAD', label: 'Dollar canadien (CA$)' },
  { code: 'MAD', label: 'Dirham marocain (MAD)' },
] as const

/**
 * Cache des formateurs `Intl.NumberFormat` par devise (un par code), pour éviter
 * d'en reconstruire un à chaque rendu.
 */
const formatters = new Map<string, Intl.NumberFormat>()
function formatterFor(currency: string): Intl.NumberFormat {
  let f = formatters.get(currency)
  if (!f) {
    // Locale française (séparateurs " " et ","), devise variable. On NE force PAS
    // le nombre de décimales : Intl choisit selon la devise (EUR/USD → 2, XAF → 0).
    f = new Intl.NumberFormat('fr-FR', { style: 'currency', currency })
    formatters.set(currency, f)
  }
  return f
}

/**
 * Formate un montant dans la devise donnée (repli 'EUR'), format français.
 * Exemples : formatMoney(6043.4) => "6 043,40 €" ; formatMoney(6043.4,'XAF') => "6 043 FCFA".
 */
export function formatMoney(value: number, currency = 'EUR'): string {
  return formatterFor(currency).format(value ?? 0)
}

/**
 * Alias rétro-compatible : formatage en euros.
 * Conservé pour les contextes SANS devise dynamique (modules purs comme
 * `src/lib/pdf.ts` en repli, et la landing publique `src/routes/index.tsx`).
 * Dans l'app authentifiée, préférer le hook `useCurrency()` (src/lib/useCurrency.ts).
 */
export function formatEUR(value: number): string {
  return formatMoney(value, 'EUR')
}

/**
 * Vérifie qu'une chaîne est une date ISO `YYYY-MM-DD` valide (format ET date
 * réelle : '2025-02-30' est rejeté). Utilisé côté client et serveur pour ne
 * stocker que des dates propres sur les lignes.
 * Exemple : isValidISODate('2025-01-15') => true ; isValidISODate('15/01/2025') => false.
 */
export function isValidISODate(s: string): boolean {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return false
  const [, y, mo, d] = m
  // Midi LOCAL (pas minuit) pour éviter tout glissement de jour dû au fuseau, puis
  // on compare aux composantes LOCALES (pas à toISOString/UTC) : ainsi on rejette
  // bien les dates impossibles (31 février → 3 mars) sans faux négatif de fuseau.
  const dt = new Date(`${y}-${mo}-${d}T12:00:00`)
  return (
    !Number.isNaN(dt.getTime()) &&
    dt.getFullYear() === Number(y) &&
    dt.getMonth() + 1 === Number(mo) &&
    dt.getDate() === Number(d)
  )
}

/**
 * Formate une date ISO `YYYY-MM-DD` au format français court.
 * Repli `''` si absente/invalide (lignes sans date : affichage neutre).
 * Exemple : formatDate('2025-01-15') => "15/01/2025".
 */
const dateFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})
export function formatDate(iso?: string): string {
  if (!iso || !isValidISODate(iso)) return ''
  // Midi local pour éviter tout glissement de jour lié au fuseau.
  return dateFormatter.format(new Date(`${iso}T12:00:00`))
}

/**
 * Convertit un objet `Date` en date ISO `YYYY-MM-DD` à partir de ses composantes
 * LOCALES (pas `toISOString`/UTC, qui décalerait d'un jour selon le fuseau).
 * Pendant inverse de `formatDate`/`new Date(iso+'T12:00:00')`.
 * Exemple : isoFromDate(new Date(2025, 0, 15)) => "2025-01-15".
 */
export function isoFromDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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
