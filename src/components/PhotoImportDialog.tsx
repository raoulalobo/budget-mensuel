import { useRef, useState } from 'react'
import { useAction, useMutation } from 'convex/react'
import {
  X,
  Camera,
  ImageUp,
  Sparkles,
  Upload,
  Trash2,
  Plus,
  Loader2,
  Check,
  AlertTriangle,
} from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useSections } from '../lib/useSections'
import DateField from './DateField'
import { downscaleImage } from '../lib/image'
import { uploadImageDataUrl } from '../lib/upload'

/**
 * Fenêtre modale d'import par PHOTO — gère PLUSIEURS images d'un coup.
 *
 * Flux :
 *  1. L'utilisateur sélectionne une ou plusieurs photos (paie, factures, tickets…).
 *     Chaque image est compressée côté client et ajoutée sous forme de vignette.
 *  2. « Analyser » envoie chaque image (encore en attente) à l'action Convex
 *     `vision.extractEntriesFromImage` (Claude), séquentiellement, et FUSIONNE
 *     les lignes détectées dans un unique tableau éditable.
 *  3. L'utilisateur corrige/complète, puis importe le tout via `budget.importEntries`.
 */

// Plafond absolu d'analyses simultanées (protège des limites de débit de l'API).
const MAX_CONCURRENCY = 8

/**
 * Concurrence ADAPTÉE au nombre de photos à analyser.
 *
 * Idée : un petit lot part entièrement en parallèle (latence minimale), un gros
 * lot monte progressivement en parallélisme mais reste plafonné pour ne pas
 * saturer l'API vision ni la bande passante. La fonction est monotone (jamais
 * décroissante) et bornée par `MAX_CONCURRENCY`.
 *
 * Exemples : 1→1, 3→3, 4→4, 8→4, 15→6, 40→8.
 */
function computeConcurrency(n: number): number {
  if (n <= 4) return n // petit lot : toutes en même temps
  if (n <= 10) return 4
  if (n <= 20) return 6
  return MAX_CONCURRENCY // gros lot : plafond
}

// Une ligne éditable de l'aperçu (montant en string pour une saisie fluide).
interface EditableRow {
  section: string
  label: string
  amount: string
  date: string // date ISO 'YYYY-MM-DD' détectée par l'IA (vide si aucune)
  sourceSeq?: number // photo d'origine (pour rattacher l'image stockée)
}

// Une photo en attente/analyse, avec sa vignette compressée et son état.
interface PendingImage {
  seq: number // numéro stable affiché à l'utilisateur ("Photo 1", "Photo 2"…)
  dataUrl: string // aperçu (vignette)
  base64: string // données envoyées à l'action
  mimeType: string
  status: 'pending' | 'done' | 'error'
}

export default function PhotoImportDialog({
  monthId,
  monthLabel,
  onClose,
}: {
  monthId: Id<'months'>
  monthLabel: string
  onClose: () => void
}) {
  const extract = useAction(api.vision.extractEntriesFromImage)
  const importEntries = useMutation(api.budget.importEntries)
  const generateUploadUrl = useMutation(api.budget.generateUploadUrl)
  const createReceipt = useMutation(api.budget.createReceipt)
  const { sections } = useSections()

  // Rubrique de repli : 1re dépense, sinon 1re rubrique.
  const fallbackKey =
    sections.find((s) => s.kind === 'expense')?.key ?? sections[0]?.key ?? ''
  // Mappe une clé détectée par l'IA vers une rubrique existante (sinon repli).
  const resolveKey = (key: string) =>
    sections.some((s) => s.key === key) ? key : fallbackKey

  const seqRef = useRef(0) // compteur stable pour numéroter les photos
  const [images, setImages] = useState<PendingImage[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  )
  const [rows, setRows] = useState<EditableRow[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const [analyzedOnce, setAnalyzedOnce] = useState(false)

  /** Ajoute une ou plusieurs photos (compression côté client). */
  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    // Réinitialise l'input pour pouvoir resélectionner le même fichier plus tard.
    e.target.value = ''
    for (const file of files) {
      try {
        const { dataUrl, base64, mime } = await downscaleImage(file)
        seqRef.current += 1
        const seq = seqRef.current
        setImages((imgs) => [
          ...imgs,
          { seq, dataUrl, base64, mimeType: mime, status: 'pending' },
        ])
      } catch {
        setErrors((es) => [...es, 'Une image est illisible et a été ignorée.'])
      }
    }
  }

  /**
   * Analyse toutes les photos encore "en attente" et fusionne leurs lignes.
   *
   * Les analyses tournent EN PARALLÈLE avec une concurrence bornée (`CONCURRENCY`) :
   * on lance N "workers" qui piochent chacun la photo suivante dans `pending`
   * jusqu'à épuisement. Le curseur partagé est sûr car JS est mono-thread
   * (l'incrément `pending[cursor++]` est synchrone, entre deux `await`).
   */
  async function handleAnalyze() {
    const pending = images.filter((i) => i.status === 'pending')
    if (pending.length === 0) return
    setAnalyzing(true)
    const total = pending.length
    let done = 0
    setProgress({ done: 0, total })

    let cursor = 0
    async function worker() {
      while (cursor < pending.length) {
        const img = pending[cursor++] // pioche atomique (synchrone)
        try {
          const res = await extract({
            imageBase64: img.base64,
            mimeType: img.mimeType,
          })
          // Fusionne les lignes détectées dans le tableau commun, en gardant le
          // lien vers la photo d'origine (sourceSeq) pour la stocker à l'import.
          setRows((rs) => [
            ...rs,
            ...res.rows.map((r) => ({
              section: resolveKey(r.section),
              label: r.label,
              amount: String(r.budget),
              // Date détectée (ligne ou document) ; vide si l'IA n'en a pas lu.
              date: r.date ?? '',
              sourceSeq: img.seq,
            })),
          ])
          if (res.errors.length > 0) {
            setErrors((es) => [
              ...es,
              ...res.errors.map((e) => `Photo ${img.seq} : ${e}`),
            ])
          }
          markStatus(img.seq, 'done')
        } catch (e) {
          setErrors((es) => [
            ...es,
            `Photo ${img.seq} : ${e instanceof Error ? e.message : 'échec de l’analyse'}`,
          ])
          markStatus(img.seq, 'error')
        }
        done += 1
        setProgress({ done, total })
      }
    }

    // Nombre de workers adapté au volume de photos (puis ils se partagent la file).
    const n = computeConcurrency(pending.length)
    await Promise.all(Array.from({ length: n }, () => worker()))

    setAnalyzing(false)
    setProgress(null)
    setAnalyzedOnce(true)
  }

  function markStatus(seq: number, status: PendingImage['status']) {
    setImages((imgs) => imgs.map((i) => (i.seq === seq ? { ...i, status } : i)))
  }

  /** Retire une vignette (n'affecte pas les lignes déjà fusionnées). */
  function removeImage(seq: number) {
    setImages((imgs) => imgs.filter((i) => i.seq !== seq))
  }

  // Modifications locales du tableau éditable.
  function updateRow(i: number, patch: Partial<EditableRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, idx) => idx !== i))
  }
  function addRow() {
    setRows((rs) => [...rs, { section: fallbackKey, label: '', amount: '0', date: '' }])
  }

  // Lignes conservées (libellé non vide), avec leur lien photo (sourceSeq).
  const keptRows = rows.filter((r) => r.label.trim().length > 0)

  const pendingCount = images.filter((i) => i.status === 'pending').length

  async function handleImport() {
    if (keptRows.length === 0) return
    setBusy(true)
    try {
      // 1) Une photo = un reçu (uploadé + enregistré UNE fois), partagé par toutes
      //    ses lignes. On ne traite que les photos réellement conservées.
      const usedSeqs = new Set(
        keptRows
          .map((r) => r.sourceSeq)
          .filter((s): s is number => s !== undefined),
      )
      const seqToReceiptId = new Map<number, Id<'receipts'>>()
      for (const seq of usedSeqs) {
        const img = images.find((i) => i.seq === seq)
        if (!img) continue
        try {
          const storageId = await uploadImageDataUrl(
            img.dataUrl,
            img.mimeType,
            () => generateUploadUrl(),
          )
          const receiptId = await createReceipt({
            storageId: storageId as Id<'_storage'>,
          })
          seqToReceiptId.set(seq, receiptId)
        } catch {
          // Échec d'upload/création du reçu : on importe la ligne sans photo.
        }
      }

      // 2) Construit les lignes en partageant le reçu de leur photo d'origine.
      const entries = keptRows.map((r) => ({
        section: r.section,
        label: r.label.trim(),
        budget: Number(r.amount) || 0,
        real: Number(r.amount) || 0,
        receiptId:
          r.sourceSeq !== undefined ? seqToReceiptId.get(r.sourceSeq) : undefined,
        date: r.date.trim() || undefined,
      }))

      await importEntries({ monthId, entries, replace })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="app-card flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <Camera className="h-4 w-4" /> Importer par photo — {monthLabel}
          </h2>
          <button className="app-btn-ghost px-2" onClick={onClose} title="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto p-5">
          {/* Zone de dépôt (aucune photo) OU grille de vignettes */}
          {images.length === 0 ? (
            <label className="flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-6 py-10 text-center text-sm text-muted-foreground hover:bg-muted/60">
              <ImageUp className="h-8 w-8" />
              Cliquez pour choisir une ou plusieurs photos, ou utilisez l'appareil
              photo (mobile).
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={handleFiles}
              />
            </label>
          ) : (
            <div className="flex flex-wrap gap-3">
              {images.map((img) => (
                <div
                  key={img.seq}
                  className="relative h-24 w-24 overflow-hidden rounded-lg border border-border"
                >
                  <img
                    src={img.dataUrl}
                    alt={`Photo ${img.seq}`}
                    className="h-full w-full object-cover"
                  />
                  {/* Badge d'état */}
                  <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">
                    {img.status === 'done' ? (
                      <Check className="h-3 w-3" />
                    ) : img.status === 'error' ? (
                      <AlertTriangle className="h-3 w-3" />
                    ) : (
                      `#${img.seq}`
                    )}
                  </span>
                  {/* Bouton retirer */}
                  <button
                    className="absolute right-1 top-1 rounded bg-black/60 p-0.5 text-white hover:bg-destructive"
                    title="Retirer cette photo"
                    onClick={() => removeImage(img.seq)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}

              {/* Ajouter d'autres photos */}
              <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:bg-muted/60">
                <Plus className="h-5 w-5" />
                Ajouter
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="hidden"
                  onChange={handleFiles}
                />
              </label>
            </div>
          )}

          {/* Bouton Analyser */}
          {images.length > 0 && (
            <button
              className="app-btn-primary self-start"
              onClick={handleAnalyze}
              disabled={analyzing || pendingCount === 0}
            >
              {analyzing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {analyzing
                ? `Analyse ${progress?.done ?? 0}/${progress?.total ?? 0}…`
                : pendingCount > 0
                  ? `Analyser ${pendingCount} photo(s)`
                  : 'Tout est analysé'}
            </button>
          )}

          {/* Erreurs / avertissements */}
          {errors.length > 0 && (
            <ul className="list-inside list-disc rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-800">
              {errors.slice(0, 8).map((err, i) => (
                <li key={i}>{err}</li>
              ))}
              {errors.length > 8 && <li>… et {errors.length - 8} autre(s)</li>}
            </ul>
          )}

          {/* Tableau éditable des lignes détectées (fusion de toutes les photos) */}
          {analyzedOnce && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {rows.length} ligne{rows.length > 1 ? 's' : ''} détectée
                  {rows.length > 1 ? 's' : ''} — vérifiez avant d'importer
                </span>
                <button className="app-btn-ghost px-2 text-xs" onClick={addRow}>
                  <Plus className="h-3.5 w-3.5" /> Ajouter
                </button>
              </div>

              {rows.length > 0 && (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Rubrique</th>
                        <th className="px-3 py-2 font-medium">Libellé</th>
                        <th className="w-32 px-3 py-2 text-right font-medium">
                          Montant
                        </th>
                        <th className="w-36 px-3 py-2 font-medium">Date</th>
                        <th className="w-10 px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={i} className="border-t border-border/60">
                          <td className="px-2 py-1.5">
                            <select
                              className="w-full rounded border border-input bg-background px-1.5 py-1 outline-none focus:ring-2 focus:ring-ring"
                              value={row.section}
                              onChange={(e) =>
                                updateRow(i, { section: e.target.value })
                              }
                            >
                              {sections.map((s) => (
                                <option key={s.key} value={s.key}>
                                  {s.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              className="w-full rounded bg-transparent px-1 py-1 outline-none focus:bg-background"
                              value={row.label}
                              onChange={(e) => updateRow(i, { label: e.target.value })}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="number"
                              step="0.01"
                              inputMode="decimal"
                              className="w-full rounded bg-transparent px-1 py-1 text-right tabular-nums outline-none focus:bg-background"
                              value={row.amount}
                              onChange={(e) => updateRow(i, { amount: e.target.value })}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <DateField
                              size="compact"
                              value={row.date}
                              onChange={(v) => updateRow(i, { date: v })}
                              clearable
                              placeholder="—"
                            />
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <button
                              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              title="Supprimer"
                              onClick={() => removeRow(i)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

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
          )}
        </div>

        {/* Pied : actions */}
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button className="app-btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button
            className="app-btn-primary"
            disabled={busy || keptRows.length === 0}
            onClick={handleImport}
          >
            <Upload className="h-4 w-4" />
            {busy ? 'Import…' : `Importer ${keptRows.length} ligne(s)`}
          </button>
        </div>
      </div>
    </div>
  )
}
