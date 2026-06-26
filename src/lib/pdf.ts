import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatAmount, currencyLabel, type MonthSummary } from './budget'

/**
 * Génération de bilans PDF (côté navigateur) via jsPDF + autotable.
 *
 * Deux exports :
 *  - `generateMonthPdf` : bilan détaillé d'un mois (résumé + graphiques + tableaux par section)
 *  - `generateYearPdf`  : bilan annuel (KPIs + graphique mensuel + tableau mois par mois)
 *
 * Les fonctions reçoivent des données déjà préparées (chaînes/nombres) afin de
 * rester indépendantes de Convex.
 *
 * Trois finitions communes (cf. helpers en tête de fichier) :
 *  1. Pied de page paginé sur CHAQUE page (titre + date de génération + « Page X/Y »).
 *  2. Graphiques dessinés avec les primitives jsPDF (donut + barres groupées).
 *  3. Écarts colorés (vert = favorable, rouge = défavorable) dans les tableaux.
 */

// Couleur d'accent de l'en-tête des tableaux (lagoon).
const ACCENT: [number, number, number] = [50, 143, 151]
// Couleur secondaire (orange) — série « Réel » des graphiques.
const ACCENT2: [number, number, number] = [224, 123, 57]
// Vert « favorable » / rouge « défavorable » pour les écarts.
const GREEN: [number, number, number] = [22, 163, 74]
const RED: [number, number, number] = [220, 38, 38]
// Gris du pied de page.
const FOOTER_GRAY: [number, number, number] = [130, 130, 130]

// Palette de tranches du donut (couleurs distinctes, lisibles à l'impression).
const DONUT_PALETTE: Array<[number, number, number]> = [
  [50, 143, 151],
  [224, 123, 57],
  [91, 124, 196],
  [88, 177, 118],
  [201, 93, 99],
  [150, 111, 196],
  [218, 165, 32],
  [120, 120, 130],
]

// Dimensions A4 portrait (mm) et marge horizontale commune.
const PAGE_W = 210
const PAGE_H = 297
const MARGIN_X = 14

/**
 * Assainit une chaîne monétaire pour les polices standard de jsPDF (Helvetica,
 * encodage WinAnsi). `Intl.NumberFormat('fr-FR')` sépare les milliers avec une
 * ESPACE FINE INSÉCABLE (U+202F) et utilise parfois l'espace insécable normale
 * (U+00A0) avant le symbole de devise. Ces glyphes n'existent pas dans WinAnsi :
 * jsPDF les rend alors comme un caractère parasite (effet « slash » entre les
 * milliers). On les remplace par une espace ASCII ordinaire.
 *
 * Exemple : "6 043,40 €" (avec U+202F) → "6 043,40 €" (avec espace normale).
 */
function pdfSafeMoney(s: string): string {
  // U+202F espace fine insécable, U+00A0 espace insécable, U+2009 espace fine.
  return s.replace(/[\u202F\u00A0\u2009]/g, ' ')
}

/**
 * Dessine un donut (camembert évidé) avec les primitives jsPDF.
 *
 * jsPDF ne sait pas remplir un secteur d'arc directement : on approxime chaque
 * tranche par un ÉVENTAIL DE TRIANGLES (centre + 2 points sur le cercle), puis on
 * superpose un disque blanc au centre pour creuser le donut.
 *
 * @param cx,cy   centre du donut (mm)
 * @param rOuter  rayon extérieur (mm)
 * @param rInner  rayon du trou central (mm)
 * @param slices  tranches { value, color } — les valeurs nulles sont ignorées
 */
function drawDonut(
  doc: jsPDF,
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  slices: Array<{ value: number; color: [number, number, number] }>,
): void {
  const total = slices.reduce((s, sl) => s + Math.max(0, sl.value), 0)
  if (total <= 0) return

  let start = -Math.PI / 2 // on démarre en haut (midi)
  for (const sl of slices) {
    if (sl.value <= 0) continue
    const angle = (sl.value / total) * Math.PI * 2
    // Remplissage ET bordure de MÊME couleur : la bordure recouvre les fines
    // coutures d'anti-aliasing entre triangles adjacents (sinon des traits clairs
    // radiaux apparaissent dans la tranche).
    doc.setFillColor(sl.color[0], sl.color[1], sl.color[2])
    doc.setDrawColor(sl.color[0], sl.color[1], sl.color[2])
    doc.setLineWidth(0.2)
    // Subdivise l'arc en pas d'~6° pour un rendu lisse.
    const steps = Math.max(2, Math.ceil(angle / (Math.PI / 30)))
    for (let i = 0; i < steps; i++) {
      const t0 = start + (angle * i) / steps
      const t1 = start + (angle * (i + 1)) / steps
      doc.triangle(
        cx,
        cy,
        cx + rOuter * Math.cos(t0),
        cy + rOuter * Math.sin(t0),
        cx + rOuter * Math.cos(t1),
        cy + rOuter * Math.sin(t1),
        'FD',
      )
    }
    start += angle
  }
  // Trou central : disque blanc → effet « donut ».
  doc.setFillColor(255, 255, 255)
  doc.circle(cx, cy, rInner, 'F')
}

/**
 * Dessine un histogramme à barres groupées (2 séries) avec les primitives jsPDF.
 *
 * Utilisé pour « Prévu vs Réel » : un groupe par poste (Revenus, Dépenses), deux
 * barres par groupe (prévu en lagoon, réel en orange). L'échelle est calée sur la
 * plus grande valeur, et chaque barre est étiquetée de son montant.
 *
 * @param x0,yBase coin bas-gauche de la zone de tracé (yBase = ligne de base)
 * @param areaW,areaH largeur/hauteur de la zone de tracé (mm)
 * @param groups   [{ label, prevu, real }]
 * @param fmt      formateur monétaire (déjà assaini pour le PDF)
 */
function drawGroupedBars(
  doc: jsPDF,
  x0: number,
  yBase: number,
  areaW: number,
  areaH: number,
  groups: Array<{ label: string; prevu: number; real: number }>,
  fmt: (n: number) => string,
): void {
  const maxVal = Math.max(1, ...groups.flatMap((g) => [g.prevu, g.real]))
  // Axe de base.
  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.3)
  doc.line(x0, yBase, x0 + areaW, yBase)

  const groupW = areaW / groups.length
  const barW = groupW * 0.3 // 2 barres + espacements dans chaque groupe
  groups.forEach((g, gi) => {
    const gx = x0 + gi * groupW
    const series: Array<{ v: number; c: [number, number, number] }> = [
      { v: g.prevu, c: ACCENT },
      { v: g.real, c: ACCENT2 },
    ]
    series.forEach((s, si) => {
      const h = (Math.max(0, s.v) / maxVal) * areaH
      const bx = gx + groupW * 0.18 + si * (barW + groupW * 0.12)
      doc.setFillColor(s.c[0], s.c[1], s.c[2])
      doc.rect(bx, yBase - h, barW, h, 'F')
      // Montant au-dessus de la barre.
      doc.setFontSize(6.5)
      doc.setTextColor(90, 90, 90)
      doc.text(fmt(s.v), bx + barW / 2, yBase - h - 1.5, { align: 'center' })
    })
    // Libellé du groupe sous l'axe.
    doc.setFontSize(8)
    doc.setTextColor(40, 40, 40)
    doc.text(g.label, gx + groupW / 2, yBase + 5, { align: 'center' })
  })
  doc.setTextColor(0, 0, 0)
}

/**
 * Pied de page paginé, appliqué APRÈS le tracé de tout le contenu.
 *
 * On itère sur toutes les pages (autotable a pu en ajouter), et on tamponne sur
 * chacune : un filet de séparation, le titre à gauche, la date de génération au
 * centre, « Page X / Y » à droite. Comme l'export tourne dans le navigateur,
 * `new Date()` est disponible et fiable ici.
 *
 * @param title titre/nom du budget rappelé en bas à gauche
 */
function stampFooters(doc: jsPDF, title: string): void {
  const pages = doc.getNumberOfPages()
  const generated = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
  const footerY = PAGE_H - 9
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    // Filet de séparation.
    doc.setDrawColor(220, 220, 220)
    doc.setLineWidth(0.3)
    doc.line(MARGIN_X, footerY - 3, PAGE_W - MARGIN_X, footerY - 3)
    // Texte gris discret.
    doc.setFontSize(8)
    doc.setTextColor(FOOTER_GRAY[0], FOOTER_GRAY[1], FOOTER_GRAY[2])
    doc.text(title, MARGIN_X, footerY)
    doc.text(`Généré le ${generated}`, PAGE_W / 2, footerY, { align: 'center' })
    doc.text(`Page ${p} / ${pages}`, PAGE_W - MARGIN_X, footerY, { align: 'right' })
  }
  doc.setTextColor(0, 0, 0)
}

/** Bilan PDF d'un mois. */
export function generateMonthPdf(opts: {
  title: string // ex. "Janvier 2025"
  summary: MonthSummary
  sections: Array<{
    label: string
    // Nature de la rubrique : oriente la couleur de l'écart et le donut des dépenses.
    kind?: 'income' | 'expense'
    rows: Array<{ label: string; budget: number; real: number }>
  }>
  // Devise d'affichage (code ISO 4217). Absent ⇒ 'EUR'.
  currency?: string
}): void {
  // Devise du document, rappelée une seule fois dans le nota bène ci-dessous.
  const currency = opts.currency ?? 'EUR'
  // Formate SANS devise (elle figure dans le NB), puis assainit pour la police PDF
  // (sinon les espaces fines insécables des milliers s'affichent en parasites).
  const fmt = (n: number) => pdfSafeMoney(formatAmount(n, currency))
  const doc = new jsPDF()
  let y = 18

  // Titre
  doc.setFontSize(18)
  doc.text(`Budget — ${opts.title}`, MARGIN_X, y)
  y += 8
  doc.setFontSize(10)
  doc.setTextColor(120)
  doc.text('Bilan généré depuis l’application Budget mensuel', MARGIN_X, y)
  y += 5
  // Nota bène : devise précisée une fois pour tout le document (montants sans symbole).
  doc.setFontSize(9)
  doc.text(`Montants exprimés en ${currencyLabel(currency)}`, MARGIN_X, y)
  doc.setTextColor(0)
  y += 8

  // ── Tableau de résumé (Revenus / Dépenses / Net, prévu vs réel) ────────────
  // L'écart affiché = réel − prévu (vision « réalisé vs planifié »). La COULEUR
  // dépend de la favorabilité : pour les revenus/net, plus = mieux (vert) ;
  // pour les dépenses, moins = mieux (vert).
  const summaryRows = [
    {
      label: 'Revenus',
      budget: opts.summary.incomeBudget,
      real: opts.summary.incomeReal,
      favorableWhenPositive: true,
    },
    {
      label: 'Dépenses',
      budget: opts.summary.expenseBudget,
      real: opts.summary.expenseReal,
      favorableWhenPositive: false,
    },
    {
      label: 'Net',
      budget: opts.summary.netBudget,
      real: opts.summary.netReal,
      favorableWhenPositive: true,
    },
  ]
  // Favorabilité par ligne (true = vert), utilisée par didParseCell ci-dessous.
  const summaryFav = summaryRows.map((r) => {
    const ecart = r.real - r.budget
    return r.favorableWhenPositive ? ecart >= 0 : ecart <= 0
  })

  autoTable(doc, {
    startY: y,
    head: [['Résumé', 'Prévu', 'Réel', 'Écart']],
    body: summaryRows.map((r) => [
      r.label,
      fmt(r.budget),
      fmt(r.real),
      fmt(r.real - r.budget),
    ]),
    headStyles: { fillColor: ACCENT },
    styles: { fontSize: 9, cellPadding: 2, overflow: 'linebreak' },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { halign: 'right', cellWidth: 34 },
      2: { halign: 'right', cellWidth: 34 },
      3: { halign: 'right', cellWidth: 34 },
    },
    // Colore la cellule « Écart » selon la favorabilité de la ligne.
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 3) {
        data.cell.styles.textColor = summaryFav[data.row.index] ? GREEN : RED
        data.cell.styles.fontStyle = 'bold'
      }
    },
    margin: { left: MARGIN_X, right: MARGIN_X },
    theme: 'grid',
  })
  y = (doc as any).lastAutoTable.finalY + 8

  // ── Graphiques (donut des dépenses + barres Prévu vs Réel) ─────────────────
  // Tranches du donut : une par rubrique de DÉPENSE, valeur = réel dépensé.
  const expenseSlices = opts.sections
    .filter((s) => s.kind === 'expense')
    .map((s) => ({
      label: s.label,
      value: s.rows.reduce((acc, r) => acc + Math.max(0, r.real), 0),
    }))
    .filter((s) => s.value > 0)

  const hasBars =
    opts.summary.incomeBudget ||
    opts.summary.incomeReal ||
    opts.summary.expenseBudget ||
    opts.summary.expenseReal

  if (expenseSlices.length > 0 || hasBars) {
    const bandTop = y
    const bandH = 62
    // Saut de page si la bande de graphiques ne tient pas (on garde ~12mm de pied).
    if (bandTop + bandH > PAGE_H - 14) {
      doc.addPage()
      y = 18
    }
    const top = y

    // — Bloc gauche : donut « Dépenses par rubrique » —
    if (expenseSlices.length > 0) {
      doc.setFontSize(11)
      doc.text('Dépenses par rubrique', MARGIN_X, top)
      const cx = MARGIN_X + 20
      const cy = top + 30
      const totalExp = expenseSlices.reduce((s, sl) => s + sl.value, 0)
      drawDonut(
        doc,
        cx,
        cy,
        18,
        10,
        expenseSlices.map((s, i) => ({
          value: s.value,
          color: DONUT_PALETTE[i % DONUT_PALETTE.length],
        })),
      )
      // Légende : pastille + libellé + pourcentage, à droite du donut.
      let ly = top + 12
      doc.setFontSize(8)
      expenseSlices.forEach((s, i) => {
        const c = DONUT_PALETTE[i % DONUT_PALETTE.length]
        doc.setFillColor(c[0], c[1], c[2])
        doc.rect(MARGIN_X + 42, ly - 2.6, 3, 3, 'F')
        doc.setTextColor(40, 40, 40)
        const pct = Math.round((s.value / totalExp) * 100)
        // Tronque les libellés longs pour éviter de mordre sur le bloc droit.
        const label = s.label.length > 18 ? s.label.slice(0, 17) + '…' : s.label
        doc.text(`${label}  ${pct}%`, MARGIN_X + 47, ly)
        ly += 5.5
      })
      doc.setTextColor(0, 0, 0)
    }

    // — Bloc droit : barres « Prévu vs Réel » (Revenus, Dépenses) —
    if (hasBars) {
      const rx = MARGIN_X + 100
      doc.setFontSize(11)
      doc.setTextColor(0, 0, 0)
      doc.text('Prévu vs Réel', rx, top)
      // Mini-légende des deux séries.
      doc.setFontSize(7.5)
      doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2])
      doc.rect(rx, top + 2.5, 3, 3, 'F')
      doc.setTextColor(60, 60, 60)
      doc.text('Prévu', rx + 4.5, top + 5)
      doc.setFillColor(ACCENT2[0], ACCENT2[1], ACCENT2[2])
      doc.rect(rx + 22, top + 2.5, 3, 3, 'F')
      doc.text('Réel', rx + 26.5, top + 5)
      doc.setTextColor(0, 0, 0)
      drawGroupedBars(
        doc,
        rx,
        top + 48, // ligne de base
        78,
        34, // hauteur max des barres
        [
          {
            label: 'Revenus',
            prevu: opts.summary.incomeBudget,
            real: opts.summary.incomeReal,
          },
          {
            label: 'Dépenses',
            prevu: opts.summary.expenseBudget,
            real: opts.summary.expenseReal,
          },
        ],
        fmt,
      )
    }

    y = top + bandH
  }

  // ── Un tableau par section non vide (avec colonne Écart colorée) ───────────
  for (const section of opts.sections) {
    if (section.rows.length === 0) continue
    const totalBudget = section.rows.reduce((s, r) => s + r.budget, 0)
    const totalReal = section.rows.reduce((s, r) => s + r.real, 0)
    // Favorabilité d'une ligne de dépense : réel ≤ prévu = vert ; de revenu : réel ≥ prévu = vert.
    const favorablePositive = section.kind !== 'expense'
    const rowFav = section.rows.map((r) => {
      const ecart = r.real - r.budget
      return favorablePositive ? ecart >= 0 : ecart <= 0
    })

    autoTable(doc, {
      startY: y,
      head: [[section.label, 'Prévu', 'Réel', 'Écart']],
      body: section.rows.map((r) => [
        r.label,
        fmt(r.budget),
        fmt(r.real),
        fmt(r.real - r.budget),
      ]),
      foot: [['Total', fmt(totalBudget), fmt(totalReal), fmt(totalReal - totalBudget)]],
      headStyles: { fillColor: ACCENT },
      footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: 2, overflow: 'linebreak' },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { halign: 'right', cellWidth: 32 },
        2: { halign: 'right', cellWidth: 32 },
        3: { halign: 'right', cellWidth: 32 },
      },
      // Colore la colonne « Écart » des lignes du corps selon la favorabilité.
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 3) {
          data.cell.styles.textColor = rowFav[data.row.index] ? GREEN : RED
        }
      },
      margin: { left: MARGIN_X, right: MARGIN_X },
      theme: 'striped',
    })
    y = (doc as any).lastAutoTable.finalY + 6

    // Saut de page si on approche du bas (en gardant la place du pied de page).
    if (y > 255) {
      doc.addPage()
      y = 18
    }
  }

  // Pied de page paginé sur toutes les pages, puis sauvegarde.
  stampFooters(doc, `Budget — ${opts.title}`)
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
  // Devise du document, rappelée une seule fois dans le nota bène ci-dessous.
  const currency = opts.currency ?? 'EUR'
  // Formate SANS devise (elle figure dans le NB), puis assainit pour la police PDF.
  const fmt = (n: number) => pdfSafeMoney(formatAmount(n, currency))
  const doc = new jsPDF()
  let y = 18

  doc.setFontSize(18)
  doc.text(`Bilan annuel — ${opts.year}`, MARGIN_X, y)
  y += 7
  // Nota bène : devise précisée une fois pour tout le document (montants sans symbole).
  doc.setFontSize(9)
  doc.setTextColor(120)
  doc.text(`Montants exprimés en ${currencyLabel(currency)}`, MARGIN_X, y)
  doc.setTextColor(0)
  y += 8

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
    styles: { fontSize: 9, cellPadding: 2, overflow: 'linebreak' },
    columnStyles: { 0: { cellWidth: 'auto' }, 1: { halign: 'right', cellWidth: 50 } },
    margin: { left: MARGIN_X, right: MARGIN_X },
    theme: 'grid',
  })
  y = (doc as any).lastAutoTable.finalY + 8

  // ── Graphique : net mensuel (barre verte si positif, rouge si négatif) ─────
  const hasMonthlyData = opts.months.some((m) => m.income || m.expense)
  if (hasMonthlyData) {
    doc.setFontSize(11)
    doc.text('Net par mois', MARGIN_X, y)
    const chartTop = y + 4
    const chartH = 38 // hauteur disponible de part et d'autre de la ligne de zéro
    const areaW = PAGE_W - 2 * MARGIN_X
    // Échelle symétrique autour de zéro (un net peut être négatif).
    const maxAbs = Math.max(1, ...opts.months.map((m) => Math.abs(m.net)))
    const zeroY = chartTop + chartH / 2
    // Axe du zéro.
    doc.setDrawColor(200, 200, 200)
    doc.setLineWidth(0.3)
    doc.line(MARGIN_X, zeroY, MARGIN_X + areaW, zeroY)

    const slotW = areaW / opts.months.length
    const barW = slotW * 0.55
    doc.setFontSize(6)
    opts.months.forEach((m, i) => {
      const h = (Math.abs(m.net) / maxAbs) * (chartH / 2)
      const bx = MARGIN_X + i * slotW + (slotW - barW) / 2
      const positive = m.net >= 0
      const c = positive ? GREEN : RED
      doc.setFillColor(c[0], c[1], c[2])
      // Barre vers le haut (positif) ou vers le bas (négatif) depuis la ligne de zéro.
      doc.rect(bx, positive ? zeroY - h : zeroY, barW, h, 'F')
      // Initiale du mois sous le graphique.
      doc.setTextColor(90, 90, 90)
      doc.text(m.name.slice(0, 3), bx + barW / 2, chartTop + chartH + 4, {
        align: 'center',
      })
    })
    doc.setTextColor(0, 0, 0)
    y = chartTop + chartH + 10
  }

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
    styles: { fontSize: 9, cellPadding: 2, overflow: 'linebreak' },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { halign: 'right', cellWidth: 36 },
      2: { halign: 'right', cellWidth: 36 },
      3: { halign: 'right', cellWidth: 36 },
    },
    // Colore le net mensuel : vert si ≥ 0, rouge sinon.
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 3) {
        const net = opts.months[data.row.index]?.net ?? 0
        data.cell.styles.textColor = net >= 0 ? GREEN : RED
      }
    },
    margin: { left: MARGIN_X, right: MARGIN_X },
    theme: 'striped',
  })

  // Pied de page paginé sur toutes les pages, puis sauvegarde.
  stampFooters(doc, `Bilan annuel — ${opts.year}`)
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
