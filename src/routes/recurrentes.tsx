import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { Plus, Trash2, Repeat } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { SECTIONS, SECTION_LABELS, type Section } from '../lib/budget'
import { useBudgetRole } from '../lib/budgetRole'
import { SkeletonTableRows } from '../components/Skeleton'

/**
 * Route /recurrentes : gestion des lignes récurrentes (loyer, abonnements…).
 * Ces modèles peuvent être appliqués à n'importe quel mois en un clic
 * (bouton « Lignes récurrentes » de la vue mensuelle).
 */
export const Route = createFileRoute('/recurrentes')({
  component: RecurringPage,
})

function RecurringPage() {
  const items = useQuery(api.recurring.listRecurring)
  const addRecurring = useMutation(api.recurring.addRecurring)
  // Droit d'écriture sur l'espace budget actif (faux pour un lecteur invité).
  const { canEdit } = useBudgetRole()

  const [section, setSection] = useState<Section>('fixed')
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const l = label.trim()
    if (!l) return
    setLabel('')
    setAmount('')
    await addRecurring({ section, label: l, amount: Number(amount) || 0 })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Repeat className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-bold">Lignes récurrentes</h1>
          <p className="text-sm text-muted-foreground">
            Loyer, abonnements, salaire… à appliquer à un mois en un clic depuis sa vue.
          </p>
        </div>
      </div>

      {/* Formulaire d'ajout (écriture : masqué pour les lecteurs invités) */}
      {canEdit && (
      <form onSubmit={handleAdd} className="app-card flex flex-wrap items-end gap-2 p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Section</label>
          <select
            className="app-input"
            value={section}
            onChange={(e) => setSection(e.target.value as Section)}
          >
            {SECTIONS.map((s) => (
              <option key={s} value={s}>
                {SECTION_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-xs text-muted-foreground">Libellé</label>
          <input
            className="app-input"
            placeholder="Ex. Loyer, Netflix, Salaire…"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="flex w-32 flex-col gap-1">
          <label className="text-xs text-muted-foreground">Montant</label>
          <input
            type="number"
            step="0.01"
            className="app-input text-right tabular-nums"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <button type="submit" className="app-btn-primary" disabled={!label.trim()}>
          <Plus className="h-4 w-4" /> Ajouter
        </button>
      </form>
      )}

      {/* Liste */}
      <div className="app-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="w-48 px-4 py-2 font-medium">Section</th>
              <th className="px-4 py-2 font-medium">Libellé</th>
              <th className="w-40 px-4 py-2 text-right font-medium">Montant</th>
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {items === undefined ? (
              <SkeletonTableRows rows={3} cols={4} />
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-center text-muted-foreground">
                  Aucune ligne récurrente — ajoutez-en une ci-dessus.
                </td>
              </tr>
            ) : (
              items.map((it) => (
                <RecurringRow key={it._id} item={it} canEdit={canEdit} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Une ligne récurrente éditable (section / libellé / montant), commit au blur. */
function RecurringRow({
  item,
  canEdit,
}: {
  item: { _id: Id<'recurringLines'>; section: Section; label: string; amount: number }
  canEdit: boolean
}) {
  const updateRecurring = useMutation(api.recurring.updateRecurring)
  const removeRecurring = useMutation(api.recurring.removeRecurring)
  const [label, setLabel] = useState(item.label)
  const [amount, setAmount] = useState(String(item.amount))

  return (
    <tr className="border-t border-border/60 hover:bg-accent/40">
      <td className="px-2 py-1.5">
        <select
          className="w-full rounded border border-input bg-background px-1.5 py-1 outline-none focus:ring-2 focus:ring-ring disabled:opacity-100"
          value={item.section}
          disabled={!canEdit}
          onChange={(e) =>
            void updateRecurring({ id: item._id, section: e.target.value as Section })
          }
        >
          {SECTIONS.map((s) => (
            <option key={s} value={s}>
              {SECTION_LABELS[s]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-1.5">
        <input
          className="w-full bg-transparent px-1 py-1 outline-none focus:rounded focus:bg-background"
          value={label}
          readOnly={!canEdit}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => {
            if (label !== item.label) void updateRecurring({ id: item._id, label })
          }}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          step="0.01"
          className="w-full rounded bg-transparent px-1 py-1 text-right tabular-nums outline-none focus:bg-background"
          value={amount}
          readOnly={!canEdit}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={() => {
            const n = Number(amount) || 0
            if (n !== item.amount) void updateRecurring({ id: item._id, amount: n })
          }}
        />
      </td>
      <td className="px-2 py-1.5 text-center">
        {canEdit && (
          <button
            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            title="Supprimer"
            onClick={() => void removeRecurring({ id: item._id })}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </td>
    </tr>
  )
}
