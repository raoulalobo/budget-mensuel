import { TrendingUp, TrendingDown, Wallet } from 'lucide-react'
import { formatEUR, type MonthSummary } from '../lib/budget'

/**
 * Trois cartes synthétisant un mois : Revenus, Dépenses, NET.
 * Chaque carte montre le montant réel en grand et le prévu en dessous.
 * (Reproduit le bloc "RÉSUMÉ DU BUDGET" de la feuille.)
 */
export default function SummaryCards({ summary }: { summary: MonthSummary }) {
  const cards = [
    {
      label: 'Revenus',
      real: summary.incomeReal,
      budget: summary.incomeBudget,
      icon: <TrendingUp className="h-5 w-5" />,
      color: '#16a34a',
    },
    {
      label: 'Dépenses',
      real: summary.expenseReal,
      budget: summary.expenseBudget,
      icon: <TrendingDown className="h-5 w-5" />,
      color: '#dc2626',
    },
    {
      label: 'Net',
      real: summary.netReal,
      budget: summary.netBudget,
      icon: <Wallet className="h-5 w-5" />,
      color: '#2563eb',
    },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {cards.map((c) => (
        <div key={c.label} className="app-card p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">
              {c.label}
            </span>
            <span
              className="flex h-9 w-9 items-center justify-center rounded-lg"
              style={{ backgroundColor: `${c.color}1a`, color: c.color }}
            >
              {c.icon}
            </span>
          </div>
          <p
            className="mt-3 text-2xl font-bold tabular-nums"
            style={{
              color:
                c.label === 'Net'
                  ? c.real >= 0
                    ? '#16a34a'
                    : '#dc2626'
                  : undefined,
            }}
          >
            {formatEUR(c.real)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Prévu : {formatEUR(c.budget)}
          </p>
        </div>
      ))}
    </div>
  )
}
