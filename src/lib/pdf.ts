import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatMoney, type MonthSummary } from './budget'

/**
 * Génération de bilans PDF (côté navigateur) via jsPDF + autotable.
 *
 * Deux exports :
 *  - `generateMonthPdf` : bilan détaillé d'un mois (résumé + tableaux par section)
 *  - `generateYearPdf`  : bilan annuel (KPIs + tableau mois par mois)
 *
 * Les fonctions reçoivent des données déjà préparées (chaînes/nombres) afin de
 * rester indépendantes de Convex.
 */

// Couleur d'accent de l'en-tête des tableaux (lagoon).
const ACCENT: [number, number, number] = [50, 143, 151]

/** Bilan PDF d'un mois. */
export function generateMonthPdf(opts: {
  title: string // ex. "Janvier 2025"
  summary: MonthSummary
  sections: Array<{
    label: string
    rows: Array<{ label: string; budget: number; real: number }>
  }>
  // Devise d'affichage (code ISO 4217). Absent ⇒ 'EUR'.
  currency?: string
}): void {
  // Formate dans la devise demandée (repli EUR) — module pur, pas de hook ici.
  const fmt = (n: number) => formatMoney(n, opts.currency ?? 'EUR')
  const doc = new jsPDF()
  const marginX = 14
  let y = 18

  // Titre
  doc.setFontSize(18)
  doc.text(`Budget — ${opts.title}`, marginX, y)
  y += 8
  doc.setFontSize(10)
  doc.setTextColor(120)
  doc.text('Bilan généré depuis l’application Budget mensuel', marginX, y)
  doc.setTextColor(0)
  y += 8

  // Tableau de résumé (Revenus / Dépenses / Net, prévu vs réel)
  autoTable(doc, {
    startY: y,
    head: [['Résumé', 'Prévu', 'Réel', 'Écart']],
    body: [
      [
        'Revenus',
        fmt(opts.summary.incomeBudget),
        fmt(opts.summary.incomeReal),
        fmt(opts.summary.incomeReal - opts.summary.incomeBudget),
      ],
      [
        'Dépenses',
        fmt(opts.summary.expenseBudget),
        fmt(opts.summary.expenseReal),
        fmt(opts.summary.expenseBudget - opts.summary.expenseReal),
      ],
      [
        'Net',
        fmt(opts.summary.netBudget),
        fmt(opts.summary.netReal),
        fmt(opts.summary.netReal - opts.summary.netBudget),
      ],
    ],
    headStyles: { fillColor: ACCENT },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
    },
    theme: 'grid',
  })
  y = (doc as any).lastAutoTable.finalY + 8

  // Un tableau par section non vide
  for (const section of opts.sections) {
    if (section.rows.length === 0) continue
    const totalBudget = section.rows.reduce((s, r) => s + r.budget, 0)
    const totalReal = section.rows.reduce((s, r) => s + r.real, 0)

    autoTable(doc, {
      startY: y,
      head: [[section.label, 'Prévu', 'Réel']],
      body: section.rows.map((r) => [
        r.label,
        fmt(r.budget),
        fmt(r.real),
      ]),
      foot: [['Total', fmt(totalBudget), fmt(totalReal)]],
      headStyles: { fillColor: ACCENT },
      footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      theme: 'striped',
    })
    y = (doc as any).lastAutoTable.finalY + 6

    // Saut de page si on approche du bas.
    if (y > 260) {
      doc.addPage()
      y = 18
    }
  }

  doc.save(`budget-${slugify(opts.title)}.pdf`)
}

/** Bilan PDF annuel (mois par mois). */
export function generateYearPdf(opts: {
  year: number
  totals: { income: number; expense: number; net: number }
  months: Array<{ name: string; income: number; expense: number; net: number }>
  // Devise d'affichage (code ISO 4217). Absent ⇒ 'EUR'.
  currency?: string
}): void {
  // Formate dans la devise demandée (repli EUR) — module pur, pas de hook ici.
  const fmt = (n: number) => formatMoney(n, opts.currency ?? 'EUR')
  const doc = new jsPDF()
  const marginX = 14
  let y = 18

  doc.setFontSize(18)
  doc.text(`Bilan annuel — ${opts.year}`, marginX, y)
  y += 10

  // KPIs annuels
  autoTable(doc, {
    startY: y,
    head: [['Indicateur', 'Montant']],
    body: [
      ['Revenus (année)', fmt(opts.totals.income)],
      ['Dépenses (année)', fmt(opts.totals.expense)],
      ['Net (année)', fmt(opts.totals.net)],
    ],
    headStyles: { fillColor: ACCENT },
    columnStyles: { 1: { halign: 'right' } },
    theme: 'grid',
  })
  y = (doc as any).lastAutoTable.finalY + 8

  // Détail mois par mois
  autoTable(doc, {
    startY: y,
    head: [['Mois', 'Revenus', 'Dépenses', 'Net']],
    body: opts.months.map((m) => [
      m.name,
      fmt(m.income),
      fmt(m.expense),
      fmt(m.net),
    ]),
    headStyles: { fillColor: ACCENT },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
    },
    theme: 'striped',
  })

  doc.save(`bilan-annuel-${opts.year}.pdf`)
}

/** Transforme un titre en nom de fichier propre : "Janvier 2025" → "janvier-2025". */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
