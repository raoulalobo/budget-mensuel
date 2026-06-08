import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { Plus, Trash2, Target } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { formatEUR } from '../lib/budget'
import { useBudgetRole } from '../lib/budgetRole'
import { SkeletonCard } from '../components/Skeleton'

/**
 * Route /epargne : objectifs d'épargne.
 * Chaque objectif a un montant visé (cible) et un montant déjà épargné, avec
 * une barre de progression. CRUD inline + récapitulatif global.
 */
export const Route = createFileRoute('/epargne')({
  component: EpargnePage,
})

function EpargnePage() {
  const goals = useQuery(api.goals.listGoals)
  const addGoal = useMutation(api.goals.addGoal)
  const [label, setLabel] = useState('')
  // Droit d'écriture sur l'espace budget actif (faux pour un lecteur invité).
  const { canEdit } = useBudgetRole()

  // Totaux globaux (épargné / visé).
  const totalCurrent = (goals ?? []).reduce((s, g) => s + g.current, 0)
  const totalTarget = (goals ?? []).reduce((s, g) => s + g.target, 0)
  const globalPct =
    totalTarget > 0 ? Math.min(100, (totalCurrent / totalTarget) * 100) : 0

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const l = label.trim()
    if (!l) return
    setLabel('')
    await addGoal({ label: l })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Objectifs d'épargne</h1>
          <p className="text-sm text-muted-foreground">
            Suivez vos objectifs et leur progression.
          </p>
        </div>
        {/* Récap global */}
        <div className="app-card flex items-center gap-3 px-5 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#7c3aed1a] text-[#7c3aed]">
            <Target className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs text-muted-foreground">Épargné / Objectif</p>
            <p className="text-lg font-bold tabular-nums">
              {formatEUR(totalCurrent)}{' '}
              <span className="text-sm font-normal text-muted-foreground">
                / {formatEUR(totalTarget)} ({Math.round(globalPct)} %)
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Liste des objectifs */}
      <div className="grid gap-4">
        {goals === undefined ? (
          <>
            <SkeletonCard lines={2} />
            <SkeletonCard lines={2} />
          </>
        ) : goals.length === 0 ? (
          <div className="app-card p-10 text-center text-muted-foreground">
            Aucun objectif — créez-en un ci-dessous (ex. « Fonds d'urgence »).
          </div>
        ) : (
          goals.map((g) => <GoalCard key={g._id} goal={g} />)
        )}
      </div>

      {/* Ajout d'objectif (écriture : masqué pour les lecteurs invités) */}
      {canEdit && (
        <form onSubmit={handleAdd} className="app-card flex items-center gap-2 p-4">
          <input
            className="app-input flex-1"
            placeholder="Nouvel objectif (ex. Vacances, Voiture, Fonds d'urgence)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button type="submit" className="app-btn-primary" disabled={!label.trim()}>
            <Plus className="h-4 w-4" /> Ajouter
          </button>
        </form>
      )}
    </div>
  )
}

/** Carte d'un objectif : libellé + montants éditables + barre de progression. */
function GoalCard({
  goal,
}: {
  goal: {
    _id: Id<'savingsGoals'>
    label: string
    target: number
    current: number
  }
}) {
  const updateGoal = useMutation(api.goals.updateGoal)
  const removeGoal = useMutation(api.goals.removeGoal)
  const [label, setLabel] = useState(goal.label)
  const [current, setCurrent] = useState(String(goal.current))
  const [target, setTarget] = useState(String(goal.target))

  const pct =
    goal.target > 0 ? Math.min(100, (goal.current / goal.target) * 100) : 0
  const reached = goal.target > 0 && goal.current >= goal.target

  return (
    <div className="app-card p-5">
      <div className="flex items-center gap-3">
        <input
          className="flex-1 bg-transparent text-lg font-semibold outline-none focus:rounded focus:bg-background"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => {
            if (label !== goal.label) void updateGoal({ goalId: goal._id, label })
          }}
        />
        <button
          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          title="Supprimer l'objectif"
          onClick={() => void removeGoal({ goalId: goal._id })}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Montants épargné / cible */}
      <div className="mt-3 flex items-center gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Épargné</span>
          <input
            type="number"
            step="0.01"
            className="w-28 rounded border border-input bg-background px-2 py-1 text-right tabular-nums outline-none focus:ring-2 focus:ring-ring"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            onBlur={() => {
              const n = Number(current) || 0
              if (n !== goal.current) void updateGoal({ goalId: goal._id, current: n })
            }}
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Objectif</span>
          <input
            type="number"
            step="0.01"
            className="w-28 rounded border border-input bg-background px-2 py-1 text-right tabular-nums outline-none focus:ring-2 focus:ring-ring"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onBlur={() => {
              const n = Number(target) || 0
              if (n !== goal.target) void updateGoal({ goalId: goal._id, target: n })
            }}
          />
        </label>
        <span
          className="ml-auto font-semibold tabular-nums"
          style={{ color: reached ? '#16a34a' : '#7c3aed' }}
        >
          {Math.round(pct)} %
        </span>
      </div>

      {/* Barre de progression */}
      <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            backgroundColor: reached ? '#16a34a' : '#7c3aed',
          }}
        />
      </div>
    </div>
  )
}
