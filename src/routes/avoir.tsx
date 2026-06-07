import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { Plus, Trash2, PiggyBank } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { formatEUR } from '../lib/budget'

/**
 * Route /avoir : patrimoine / placements (onglet "Avoir" de la feuille).
 * Liste éditable des placements avec total cumulé.
 */
export const Route = createFileRoute('/avoir')({
  component: AvoirPage,
})

function AvoirPage() {
  const assets = useQuery(api.budget.listAssets)
  const addAsset = useMutation(api.budget.addAsset)
  const [label, setLabel] = useState('')

  const total = (assets ?? []).reduce((sum, a) => sum + a.amount, 0)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const l = label.trim()
    if (!l) return
    setLabel('')
    await addAsset({ label: l })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Avoir</h1>
          <p className="text-sm text-muted-foreground">
            Vos placements et votre patrimoine.
          </p>
        </div>
        {/* Total du patrimoine */}
        <div className="app-card flex items-center gap-3 px-5 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#7c3aed1a] text-[#7c3aed]">
            <PiggyBank className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-xl font-bold tabular-nums">{formatEUR(total)}</p>
          </div>
        </div>
      </div>

      <div className="app-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Placement</th>
              <th className="w-40 px-4 py-2 text-right font-medium">Montant</th>
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {assets === undefined ? (
              <tr>
                <td colSpan={3} className="px-4 py-3 text-muted-foreground">
                  Chargement…
                </td>
              </tr>
            ) : assets.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-3 text-center text-muted-foreground">
                  Aucun placement — ajoutez-en un ci-dessous.
                </td>
              </tr>
            ) : (
              assets.map((a) => <AssetRow key={a._id} asset={a} />)
            )}
          </tbody>
        </table>

        {/* Formulaire d'ajout */}
        <form
          onSubmit={handleAdd}
          className="flex items-center gap-2 border-t border-border px-4 py-3"
        >
          <input
            className="app-input flex-1"
            placeholder="Ajouter un placement (ex. Livret A)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button type="submit" className="app-btn-primary" disabled={!label.trim()}>
            <Plus className="h-4 w-4" /> Ajouter
          </button>
        </form>
      </div>
    </div>
  )
}

/** Une ligne de placement éditable (libellé + montant), commit au blur. */
function AssetRow({
  asset,
}: {
  asset: { _id: Id<'assets'>; label: string; amount: number }
}) {
  const updateAsset = useMutation(api.budget.updateAsset)
  const removeAsset = useMutation(api.budget.removeAsset)
  const [label, setLabel] = useState(asset.label)
  const [amount, setAmount] = useState(String(asset.amount))

  return (
    <tr className="border-t border-border/60 hover:bg-accent/40">
      <td className="px-4 py-1.5">
        <input
          className="w-full bg-transparent px-1 py-1 outline-none focus:rounded focus:bg-background"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => {
            if (label !== asset.label) void updateAsset({ assetId: asset._id, label })
          }}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          step="0.01"
          inputMode="decimal"
          className="w-full rounded bg-transparent px-1 py-1 text-right tabular-nums outline-none focus:bg-background"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={() => {
            const n = Number(amount) || 0
            if (n !== asset.amount) void updateAsset({ assetId: asset._id, amount: n })
          }}
        />
      </td>
      <td className="px-2 py-1.5 text-center">
        <button
          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          title="Supprimer"
          onClick={() => void removeAsset({ assetId: asset._id })}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </td>
    </tr>
  )
}
