import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { formatEUR, monthName } from '../lib/budget'

/**
 * Route /mois : grille des 12 mois de l'année.
 * Chaque carte indique le NET réel du mois (s'il contient des données) et
 * renvoie vers la vue détaillée correspondante.
 */
export const Route = createFileRoute('/mois/')({
  component: MonthsIndex,
})

// Pour cette V1 on travaille sur l'année 2025 (celle de la feuille importée).
const YEAR = 2025

function MonthsIndex() {
  const months = useQuery(api.budget.listMonths)

  // Indexe les résumés par numéro de mois pour un accès direct.
  const byMonth = new Map(
    (months ?? [])
      .filter((m) => m.year === YEAR)
      .map((m) => [m.month, m]),
  )

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Mes mois — {YEAR}</h1>
        <p className="text-sm text-muted-foreground">
          Cliquez sur un mois pour saisir ou consulter son budget.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
          const data = byMonth.get(m)
          const net = data?.summary.netReal ?? 0
          const hasData =
            !!data &&
            (data.summary.incomeReal !== 0 || data.summary.expenseReal !== 0)

          return (
            <Link
              key={m}
              to="/mois/$year/$month"
              params={{ year: String(YEAR), month: String(m) }}
              className="app-card p-5 transition hover:ring-2 hover:ring-ring"
            >
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold">{monthName(m)}</span>
                {hasData ? (
                  <span
                    className="app-badge"
                    style={{
                      backgroundColor: net >= 0 ? '#16a34a1a' : '#dc26261a',
                      color: net >= 0 ? '#16a34a' : '#dc2626',
                    }}
                  >
                    {net >= 0 ? 'Excédent' : 'Déficit'}
                  </span>
                ) : (
                  <span className="app-badge bg-muted text-muted-foreground">
                    Vide
                  </span>
                )}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">Net réel</p>
              <p
                className="text-xl font-bold tabular-nums"
                style={{ color: hasData ? (net >= 0 ? '#16a34a' : '#dc2626') : undefined }}
              >
                {hasData ? formatEUR(net) : '—'}
              </p>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
