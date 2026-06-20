import { useState } from 'react'
import { useAction, useMutation } from 'convex/react'
import {
  X,
  Mic,
  MicOff,
  ImagePlus,
  Sparkles,
  Loader2,
  Plus,
} from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useCurrency } from '../lib/useCurrency'
import { type SectionDef } from '../lib/useSections'
import { downscaleImage } from '../lib/image'
import { uploadImageDataUrl } from '../lib/upload'
import { useSpeechToText } from '../lib/speech'

/**
 * Fenêtre modale d'AJOUT d'une ligne de budget.
 *
 * Permet de saisir en une fois : libellé, prévu, réel, une note (clavier ou
 * dictée vocale) et une photo justificative (avec analyse IA pour pré-remplir le
 * montant réel). La ligne — et le reçu de la photo — ne sont créés qu'à la
 * validation (« Ajouter »), ce qui évite tout fichier orphelin si on annule.
 */
export default function AddEntryDialog({
  monthId,
  section,
  onClose,
}: {
  monthId: Id<'months'>
  section: SectionDef
  onClose: () => void
}) {
  // Devise de l'espace budget courant (pour le montant détecté par l'IA).
  const { format: fmt } = useCurrency()
  const addEntry = useMutation(api.budget.addEntry)
  const generateUploadUrl = useMutation(api.budget.generateUploadUrl)
  const createReceipt = useMutation(api.budget.createReceipt)
  const analyze = useAction(api.vision.extractEntriesFromImage)

  const [label, setLabel] = useState('')
  const [budget, setBudget] = useState('')
  const [real, setReal] = useState('')
  const [note, setNote] = useState('')
  const [tags, setTags] = useState('')
  // Photo choisie, gardée localement (uploadée seulement à la validation).
  const [image, setImage] = useState<{
    dataUrl: string
    base64: string
    mime: string
  } | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [detected, setDetected] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Dictée vocale → ajoute la transcription à la note.
  const speech = useSpeechToText({
    lang: 'fr-FR',
    onResult: (text) => setNote((prev) => (prev ? `${prev} ${text}` : text)),
  })

  /** Choisit une photo (compressée, gardée en local). */
  async function handlePickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setError(null)
    setDetected(null)
    try {
      const { dataUrl, base64, mime } = await downscaleImage(file)
      setImage({ dataUrl, base64, mime })
    } catch {
      setError('Image illisible.')
    }
  }

  /**
   * Analyse IA de la photo : propose le total pour le champ Réel ET pré-remplit
   * le libellé et la note (sans jamais écraser une saisie déjà faite).
   */
  async function handleAnalyze() {
    if (!image) return
    setAnalyzing(true)
    setError(null)
    setDetected(null)
    try {
      const res = await analyze({ imageBase64: image.base64, mimeType: image.mime })
      if (res.errors.length > 0 && res.rows.length === 0) {
        setError(res.errors[0])
        return
      }
      // Montant : on privilégie le TOTAL imprimé lu par l'IA ; à défaut (total
      // illisible), on retombe sur la somme des articles détectés.
      const total =
        res.summary.total > 0
          ? res.summary.total
          : res.rows.reduce((s, r) => s + (r.real || r.budget || 0), 0)
      setDetected(Math.round(total * 100) / 100)

      // Libellé : on remplit le champ s'il est encore vide (résumé IA, sinon
      // libellé de la première ligne détectée).
      const aiLabel = res.summary.label || res.rows[0]?.label || ''
      if (!label.trim() && aiLabel) setLabel(aiLabel)
      // Note : on remplit si vide et si l'IA a produit une note (détail des
      // articles + contexte).
      if (!note.trim() && res.summary.note) setNote(res.summary.note)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'analyse.")
    } finally {
      setAnalyzing(false)
    }
  }

  /** Crée la ligne (et le reçu de la photo) après validation. */
  async function handleAdd() {
    const trimmed = label.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      let receiptId: Id<'receipts'> | undefined
      if (image) {
        const storageId = await uploadImageDataUrl(
          image.dataUrl,
          image.mime,
          () => generateUploadUrl(),
        )
        receiptId = await createReceipt({ storageId: storageId as Id<'_storage'> })
      }
      const tagList = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      await addEntry({
        monthId,
        section: section.key,
        label: trimmed,
        budget: Number(budget) || 0,
        real: Number(real) || 0,
        note: note.trim() || undefined,
        receiptId,
        tags: tagList.length > 0 ? tagList : undefined,
      })
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
        className="app-card flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <span
              className="app-badge"
              style={{
                backgroundColor: `${section.color}1a`,
                color: section.color,
              }}
            >
              {section.label}
            </span>
            <h2 className="font-semibold">Nouvelle ligne</h2>
          </div>
          <button className="app-btn-ghost px-2" onClick={onClose} title="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto p-5">
          {/* Libellé */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Libellé</label>
            <input
              autoFocus
              className="app-input"
              placeholder="Ex. Courses, Loyer, Salaire…"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          {/* Montants */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Prévu</label>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                className="app-input text-right tabular-nums"
                placeholder="0"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Réel</label>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                className="app-input text-right tabular-nums"
                placeholder="0"
                value={real}
                onChange={(e) => setReal(e.target.value)}
              />
            </div>
          </div>

          {/* Tags (séparés par des virgules) */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Tags</label>
            <input
              className="app-input"
              placeholder="Ex. vacances, pro, urgent (séparés par des virgules)"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </div>

          {/* Photo justificative */}
          <div className="rounded-md border border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">Photo / justificatif</span>
              <div className="flex gap-2">
                <label className="app-btn-ghost cursor-pointer px-2 text-xs">
                  <ImagePlus className="h-3.5 w-3.5" />
                  {image ? 'Changer' : 'Attacher'}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handlePickImage}
                  />
                </label>
                {image && (
                  <button
                    className="app-btn-ghost px-2 text-xs"
                    onClick={handleAnalyze}
                    disabled={analyzing}
                  >
                    {analyzing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    Analyser
                  </button>
                )}
              </div>
            </div>

            {image ? (
              <img
                src={image.dataUrl}
                alt="Justificatif"
                className="max-h-40 w-full rounded object-contain"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Optionnel : attachez un ticket / une facture.
              </p>
            )}

            {detected !== null && (
              <div className="mt-2 flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
                <span>
                  Montant détecté :{' '}
                  <strong className="tabular-nums">{fmt(detected)}</strong>
                </span>
                <button
                  className="app-btn-primary px-3 py-1 text-xs"
                  onClick={() => setReal(String(detected))}
                >
                  Appliquer au réel
                </button>
              </div>
            )}
            {error && (
              <p className="mt-2 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-800">
                {error}
              </p>
            )}
          </div>

          {/* Note (clavier ou dictée vocale) */}
          <div className="rounded-md border border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">Note</span>
              {speech.supported && (
                <button
                  className={
                    speech.listening
                      ? 'app-btn-danger px-2 text-xs'
                      : 'app-btn-ghost px-2 text-xs'
                  }
                  onClick={() => (speech.listening ? speech.stop() : speech.start())}
                  title={speech.listening ? 'Arrêter la dictée' : 'Dicter la note'}
                >
                  {speech.listening ? (
                    <MicOff className="h-3.5 w-3.5" />
                  ) : (
                    <Mic className="h-3.5 w-3.5" />
                  )}
                  {speech.listening ? 'Stop' : 'Dicter'}
                </button>
              )}
            </div>
            <textarea
              className="app-input min-h-16"
              placeholder="Ajouter une note (ou utilisez le micro)…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {speech.listening && (
              <p className="mt-1 text-xs text-destructive">🎙️ Écoute en cours…</p>
            )}
          </div>
        </div>

        {/* Pied : actions */}
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button className="app-btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button
            className="app-btn-primary"
            disabled={busy || !label.trim()}
            onClick={handleAdd}
          >
            <Plus className="h-4 w-4" />
            {busy ? 'Ajout…' : 'Ajouter'}
          </button>
        </div>
      </div>
    </div>
  )
}
