import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Download, FileDown, Sparkles } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import {
  EXPENSE_SECTIONS,
  SECTION_COLORS,
  SECTION_LABELS,
  formatEUR,
  monthName,
} from '../lib/budget'
import { generateYearPdf } from '../lib/pdf'
import YearSelector from '../components/YearSelector'

/**
 * Route "/" : tableau de bord annuel.
 *
 * Agrège tous les mois de l'utilisateur pour afficher :
 *  - 4 indicateurs clés (Revenus, Dépenses, Net annuels + Patrimoine)
 *  - un graphique barres Revenus vs Dépenses par mois
 *  - une courbe d'évolution du Net mensuel
 *  - un anneau de répartition des dépenses du dernier mois renseigné
 *
 * Si la base est vide, on propose d'importer les données de démo (Janvier 2025).
 */
export const Route = createFileRoute('/')({
  component: Dashboard,
})

function Dashboard() {
  const months = useQuery(api.budget.listMonths)
  const assets = useQuery(api.budget.listAssets)
  // Année sélectionnée (hook appelé inconditionnellement, avant tout return).
  const [picked, setPicked] = useState<number | null>(null)

  // Tant que les données chargent.
  if (months === undefined || assets === undefined) {
    return <p className="text-muted-foreground">Chargement du tableau de bord…</p>
  }

  // Base vide => écran d'accueil avec import de démo.
  if (months.length === 0) {
    return <EmptyState />
  }

  // Année affichée : la plus récente avec des données par défaut, sinon en cours.
  const currentYear = new Date().getFullYear()
  const defaultYear = Math.max(...months.map((m) => m.year))
  const year = picked ?? (defaultYear || currentYear)

  // ── Agrégats annuels (sur les montants réels) ──────────────────────────────
  const yearMonths = months.filter((m) => m.year === year)
  const totalIncome = yearMonths.reduce((s, m) => s + m.summary.incomeReal, 0)
  const totalExpense = yearMonths.reduce((s, m) => s + m.summary.expenseReal, 0)
  const totalNet = totalIncome - totalExpense
  const patrimoine = assets.reduce((s, a) => s + a.amount, 0)

  // ── Données du graphique mensuel (1 → 12) ──────────────────────────────────
  const byMonth = new Map(yearMonths.map((m) => [m.month, m.summary]))
  const monthlyData = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1
    const s = byMonth.get(m)
    return {
      mois: monthName(m).slice(0, 3), // "Jan", "Fév"...
      Revenus: round(s?.incomeReal ?? 0),
      Dépenses: round(s?.expenseReal ?? 0),
      Net: round(s?.netReal ?? 0),
    }
  })

  // Dernier mois renseigné (pour l'anneau de répartition).
  const lastFilled = [...yearMonths]
    .filter((m) => m.summary.incomeReal !== 0 || m.summary.expenseReal !== 0)
    .sort((a, b) => b.month - a.month)[0]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Tableau de bord — {year}</h1>
          <p className="text-sm text-muted-foreground">
            Vue d'ensemble de votre année budgétaire.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Sélecteur d'année */}
          <YearSelector year={year} onChange={setPicked} />
          {/* Export du bilan annuel en PDF */}
          <button
            className="app-btn-ghost"
            onClick={() =>
              generateYearPdf({
                year,
              totals: {
                income: totalIncome,
                expense: totalExpense,
                net: totalNet,
                assets: patrimoine,
              },
              months: Array.from({ length: 12 }, (_, i) => {
                const s = byMonth.get(i + 1)
                return {
                  name: monthName(i + 1),
                  income: s?.incomeReal ?? 0,
                  expense: s?.expenseReal ?? 0,
                  net: s?.netReal ?? 0,
                }
              }),
            })
          }
        >
            <FileDown className="h-4 w-4" /> Exporter PDF
          </button>
        </div>
      </div>

      {/* Indicateurs clés */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Revenus (année)" value={totalIncome} color="#16a34a" />
        <Kpi label="Dépenses (année)" value={totalExpense} color="#dc2626" />
        <Kpi
          label="Net (année)"
          value={totalNet}
          color={totalNet >= 0 ? '#16a34a' : '#dc2626'}
        />
        <Kpi label="Patrimoine (Avoir)" value={patrimoine} color="#7c3aed" />
      </div>

      {/* Graphiques principaux */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Revenus vs Dépenses par mois">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthlyData} margin={{ left: -10, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="mois" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v: number) => formatEUR(v)} />
              <Legend />
              <Bar dataKey="Revenus" fill="#16a34a" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Dépenses" fill="#dc2626" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Évolution du solde net">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={monthlyData} margin={{ left: -10, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="mois" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v: number) => formatEUR(v)} />
              <Line
                type="monotone"
                dataKey="Net"
                stroke="#2563eb"
                strokeWidth={2.5}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Répartition des dépenses : dernier mois renseigné + sur l'année */}
      <div className="grid gap-6 lg:grid-cols-2">
        {lastFilled && <ExpenseBreakdown year={year} month={lastFilled.month} />}
        <YearExpenseBreakdown year={year} />
      </div>
    </div>
  )
}

/**
 * Anneau de répartition des dépenses RÉELLES par section sur toute l'année.
 */
function YearExpenseBreakdown({ year }: { year: number }) {
  const data = useQuery(api.budget.yearExpenseBreakdown, { year })
  if (!data) return null
  const slices = data
    .map((d) => ({
      name: SECTION_LABELS[d.section as keyof typeof SECTION_LABELS] ?? d.section,
      value: round(d.total),
      color:
        SECTION_COLORS[d.section as keyof typeof SECTION_COLORS] ?? '#888',
    }))
    .filter((s) => s.value > 0)
  if (slices.length === 0) return null

  return (
    <ChartCard title={`Répartition des dépenses — année ${year}`}>
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={70}
            outerRadius={110}
            paddingAngle={2}
          >
            {slices.map((s) => (
              <Cell key={s.name} fill={s.color} />
            ))}
          </Pie>
          <Tooltip formatter={(v: number) => formatEUR(v)} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

/**
 * Anneau de répartition des dépenses (par section) d'un mois donné.
 * Récupère le détail du mois via `getMonth` pour additionner par section.
 */
function ExpenseBreakdown({ year, month }: { year: number; month: number }) {
  const data = useQuery(api.budget.getMonth, { year, month })
  if (!data) return null

  // Total réel par section de dépense.
  const slices = EXPENSE_SECTIONS.map((section) => ({
    name: SECTION_LABELS[section],
    value: round(
      data.entries
        .filter((e) => e.section === section)
        .reduce((s, e) => s + e.real, 0),
    ),
    color: SECTION_COLORS[section],
  })).filter((s) => s.value > 0)

  if (slices.length === 0) return null

  return (
    <ChartCard title={`Répartition des dépenses — ${monthName(month)} ${year}`}>
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={70}
            outerRadius={110}
            paddingAngle={2}
          >
            {slices.map((s) => (
              <Cell key={s.name} fill={s.color} />
            ))}
          </Pie>
          <Tooltip formatter={(v: number) => formatEUR(v)} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

/** Indicateur clé : une carte avec un libellé et un montant coloré. */
function Kpi({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div className="app-card p-5">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums" style={{ color }}>
        {formatEUR(value)}
      </p>
    </div>
  )
}

/** Conteneur de graphique (titre + zone). */
function ChartCard({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="app-card p-5">
      <h2 className="mb-4 font-semibold">{title}</h2>
      {children}
    </div>
  )
}

/** Écran affiché quand l'utilisateur n'a encore aucune donnée. */
function EmptyState() {
  const seed = useMutation(api.seed.seedDemo)

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="app-card max-w-md p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Sparkles className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-bold">Bienvenue dans votre budget</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Votre espace est vide. Importez les données de démonstration
          (Janvier 2025 + patrimoine) pour découvrir l'application, ou
          commencez à saisir vos propres mois.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <button className="app-btn-primary" onClick={() => void seed({})}>
            <Download className="h-4 w-4" /> Importer les données de démo
          </button>
          <Link to="/mois" className="app-btn-ghost">
            Saisir mes propres données
          </Link>
        </div>
      </div>
    </div>
  )
}

/** Arrondit à 2 décimales pour des graphiques propres. */
function round(n: number): number {
  return Math.round(n * 100) / 100
}
