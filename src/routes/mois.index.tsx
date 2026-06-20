import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { monthName } from '../lib/budget'
import { useCurrency } from '../lib/useCurrency'
import YearSelector from '../components/YearSelector'
import { Skeleton } from '../components/Skeleton'

/**
 * Route /mois : grille des 12 mois d'une année sélectionnable.
 *
 * Un sélecteur d'année permet de naviguer entre années et donc de CRÉER des mois
 * de n'importe quelle année : cliquer sur une carte de mois crée le mois s'il
 * n'existe pas encore (via `ensureMonth`, idempotent) puis ouvre sa vue.
 *
 * Année par défaut : la plus récente où l'utilisateur a des mois, sinon l'année
 * civile en cours.
 */
export const Route = createFileRoute('/mois/')({
  component: MonthsIndex,
})

function MonthsIndex() {
  const months = useQuery(api.budget.listMonths)
  const ensureMonth = useMutation(api.budget.ensureMonth)
  const navigate = useNavigate()
  // Devise de l'espace budget courant (pour le net affiché par mois).
  const { format: fmt } = useCurrency()

  // Année affichée : suit le défaut tant que l'utilisateur n'a pas choisi.
  const currentYear = new Date().getFullYear()
  const defaultYear = months?.length
    ? Math.max(...months.map((m) => m.year))
    : currentYear
  const [picked, setPicked] = useState<number | null>(null)
  const year = picked ?? defaultYear

  // Indexe les résumés de l'année courante par numéro de mois.
  const byMonth = new Map(
    (months ?? []).filter((m) => m.year === year).map((m) => [m.month, m]),
  )

  /** Crée le mois si besoin (idempotent) puis ouvre sa vue détaillée. */
  async function openMonth(m: number) {
    await ensureMonth({ year, month: m })
    navigate({
      to: '/mois/$year/$month',
      params: { year: String(year), month: String(m) },
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Mes mois — {year}</h1>
          <p className="text-sm text-muted-foreground">
            Cliquez sur un mois pour le créer, le saisir ou le consulter.
          </p>
        </div>
        <YearSelector year={year} onChange={setPicked} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {months === undefined
          ? // Esquisse : 12 cartes de mois pendant le chargement.
            Array.from({ length: 12 }, (_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))
          : Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
          const data = byMonth.get(m)
          const net = data?.summary.netReal ?? 0
          const hasData =
            !!data &&
            (data.summary.incomeReal !== 0 || data.summary.expenseReal !== 0)

          return (
            <button
              key={m}
              type="button"
              onClick={() => void openMonth(m)}
              className="app-card p-5 text-left transition hover:ring-2 hover:ring-ring"
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
                style={{
                  color: hasData ? (net >= 0 ? '#16a34a' : '#dc2626') : undefined,
                }}
              >
                {hasData ? fmt(net) : '—'}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
