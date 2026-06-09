import { useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import { X, Upload, FileUp } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useSections } from '../lib/useSections'
import { parseBudgetCsv } from '../lib/csv'

/**
 * Fenêtre modale d'import CSV/TSV dans un mois.
 *
 * L'utilisateur peut :
 *  - choisir une section cible (ou « Auto » : la section est lue en 1re colonne)
 *  - coller du texte OU charger un fichier .csv/.tsv
 *  - décider de remplacer les lignes existantes du mois
 *
 * Un aperçu en direct montre le nombre de lignes valides et les erreurs.
 */
export default function ImportDialog({
  monthId,
  monthLabel,
  onClose,
}: {
  monthId: Id<'months'>
  monthLabel: string
  onClose: () => void
}) {
  const importEntries = useMutation(api.budget.importEntries)
  const { sections } = useSections()
  const [text, setText] = useState('')
  const [forced, setForced] = useState<'auto' | string>('auto')
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState(false)

  // Parse en direct le texte saisi pour l'aperçu (rubriques dynamiques).
  const parsed = useMemo(
    () =>
      parseBudgetCsv(text, forced === 'auto' ? undefined : forced, sections),
    [text, forced, sections],
  )

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setText(await file.text())
  }

  async function handleImport() {
    if (parsed.rows.length === 0) return
    setBusy(true)
    try {
      await importEntries({ monthId, entries: parsed.rows, replace })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  // Exemple de format adapté au mode choisi.
  const example =
    forced === 'auto'
      ? 'Dépenses fixes;Loyer;800;800\nRevenus;Salaire;2500;2500'
      : 'Loyer;800;800\nÉlectricité;45;42,10'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="app-card flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-semibold">Importer un CSV — {monthLabel}</h2>
          <button className="app-btn-ghost px-2" onClick={onClose} title="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto p-5">
          {/* Choix de la section */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Rubrique cible</label>
            <select
              className="app-input"
              value={forced}
              onChange={(e) => setForced(e.target.value)}
            >
              <option value="auto">Auto (rubrique en 1re colonne)</option>
              {sections.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Format attendu :{' '}
              <code className="rounded bg-muted px-1">
                {forced === 'auto'
                  ? 'Section;Libellé;Prévu;Réel'
                  : 'Libellé;Prévu;Réel'}
              </code>{' '}
              (séparateur tab, « ; » ou « , »).
            </p>
          </div>

          {/* Zone de collage + fichier */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Données</label>
              <label className="app-btn-ghost cursor-pointer px-2 text-xs">
                <FileUp className="h-3.5 w-3.5" /> Charger un fichier
                <input
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv"
                  className="hidden"
                  onChange={handleFile}
                />
              </label>
            </div>
            <textarea
              className="app-input min-h-[140px] font-mono text-xs"
              placeholder={example}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>

          {/* Aperçu */}
          <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
            <span className="font-medium text-emerald-600">
              {parsed.rows.length} ligne{parsed.rows.length > 1 ? 's' : ''} valide
              {parsed.rows.length > 1 ? 's' : ''}
            </span>
            {parsed.errors.length > 0 && (
              <ul className="mt-1 list-inside list-disc text-xs text-destructive">
                {parsed.errors.slice(0, 5).map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
                {parsed.errors.length > 5 && (
                  <li>… et {parsed.errors.length - 5} autre(s)</li>
                )}
              </ul>
            )}
          </div>

          {/* Option remplacement */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={replace}
              onChange={(e) => setReplace(e.target.checked)}
            />
            Remplacer toutes les lignes existantes du mois
          </label>
        </div>

        {/* Pied : actions */}
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button className="app-btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button
            className="app-btn-primary"
            disabled={busy || parsed.rows.length === 0}
            onClick={handleImport}
          >
            <Upload className="h-4 w-4" />
            {busy ? 'Import…' : `Importer ${parsed.rows.length} ligne(s)`}
          </button>
        </div>
      </div>
    </div>
  )
}
