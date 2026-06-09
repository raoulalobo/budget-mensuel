import { useState } from 'react'
import { useAction, useMutation, useQuery } from 'convex/react'
import {
  X,
  Mic,
  MicOff,
  ImagePlus,
  Sparkles,
  Trash2,
  Save,
  Loader2,
  ExternalLink,
} from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { formatEUR, type Section } from '../lib/budget'
import { downscaleImage } from '../lib/image'
import { uploadImageDataUrl } from '../lib/upload'
import { useSpeechToText } from '../lib/speech'

/** Ligne telle que fournie par getMonth (sous-ensemble utilisé ici). */
export interface DetailEntry {
  _id: Id<'entries'>
  section: Section
  label: string
  budget: number
  real: number
  note?: string
  receiptId?: Id<'receipts'>
  tags?: string[]
}

/**
 * Fenêtre modale de DÉTAIL d'une ligne de budget.
 *
 * Affiche : section, libellé, prévu/réel/écart, une NOTE éditable (clavier ou
 * dictée vocale), et la PHOTO justificative. Permet d'attacher/remplacer une
 * photo, de relancer une ANALYSE IA sur cette photo (pour proposer un montant),
 * et de supprimer la ligne. Les montants restent édités en ligne dans le tableau.
 */
export default function EntryDetailDialog({
  entry,
  sectionLabel,
  sectionColor,
  onClose,
}: {
  entry: DetailEntry
  sectionLabel: string
  sectionColor: string
  onClose: () => void
}) {
  const updateEntry = useMutation(api.budget.updateEntry)
  const removeEntry = useMutation(api.budget.removeEntry)
  const generateUploadUrl = useMutation(api.budget.generateUploadUrl)
  const createReceipt = useMutation(api.budget.createReceipt)
  const analyze = useAction(api.vision.extractEntriesFromImage)
  // URL signée de la photo (réactive ; null si pas de photo).
  const photoUrl = useQuery(api.budget.entryPhotoUrl, { entryId: entry._id })

  const [note, setNote] = useState(entry.note ?? '')
  const [tags, setTags] = useState((entry.tags ?? []).join(', '))
  const [savingNote, setSavingNote] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [detected, setDetected] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Base64 de la photo fraîchement attachée (évite un refetch pour l'analyse).
  const [freshImage, setFreshImage] = useState<{ base64: string; mime: string } | null>(
    null,
  )

  // Dictée vocale : on ajoute le texte transcrit à la note.
  const speech = useSpeechToText({
    lang: 'fr-FR',
    onResult: (text) => setNote((prev) => (prev ? `${prev} ${text}` : text)),
  })

  const ecart = entry.budget - entry.real
  const noteDirty = note !== (entry.note ?? '')

  async function handleSaveNote() {
    setSavingNote(true)
    try {
      await updateEntry({ entryId: entry._id, note })
    } finally {
      setSavingNote(false)
    }
  }

  // Tags : commit au blur si la liste a changé.
  function handleSaveTags() {
    const arr = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const current = entry.tags ?? []
    if (arr.join('|') !== current.join('|')) {
      void updateEntry({ entryId: entry._id, tags: arr })
    }
  }

  /** Attache (ou remplace) une photo : compression → upload → lien à la ligne. */
  async function handleAttach(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    setError(null)
    setDetected(null)
    try {
      const { dataUrl, base64, mime } = await downscaleImage(file)
      const storageId = await uploadImageDataUrl(dataUrl, mime, () =>
        generateUploadUrl(),
      )
      // Une attache = un reçu dédié à cette ligne.
      const receiptId = await createReceipt({
        storageId: storageId as Id<'_storage'>,
      })
      await updateEntry({ entryId: entry._id, receiptId })
      setFreshImage({ base64, mime }) // dispo pour l'analyse immédiate
    } catch {
      setError("Échec de l'ajout de la photo.")
    } finally {
      setUploading(false)
    }
  }

  /** Récupère le base64 de la photo (fraîche, sinon refetch de l'URL stockée). */
  async function getImageBase64(): Promise<{ base64: string; mime: string } | null> {
    if (freshImage) return freshImage
    if (!photoUrl) return null
    const blob = await (await fetch(photoUrl)).blob()
    const dataUrl: string = await new Promise((resolve) => {
      const r = new FileReader()
      r.onloadend = () => resolve(r.result as string)
      r.readAsDataURL(blob)
    })
    return { base64: dataUrl.split(',')[1] ?? '', mime: blob.type || 'image/jpeg' }
  }

  /**
   * Analyse IA de la photo : propose le total détecté à appliquer au réel et,
   * si la note est encore vide, génère et enregistre une note pertinente.
   */
  async function handleAnalyze() {
    setAnalyzing(true)
    setError(null)
    setDetected(null)
    try {
      const img = await getImageBase64()
      if (!img) {
        setError('Aucune photo à analyser.')
        return
      }
      const res = await analyze({ imageBase64: img.base64, mimeType: img.mime })
      if (res.errors.length > 0 && res.rows.length === 0) {
        setError(res.errors[0])
        return
      }
      // Montant : on privilégie le TOTAL imprimé lu par l'IA ; à défaut, somme
      // des articles détectés.
      const total =
        res.summary.total > 0
          ? res.summary.total
          : res.rows.reduce((s, r) => s + (r.real || r.budget || 0), 0)
      setDetected(Math.round(total * 100) / 100)

      // Note : si la ligne n'en a pas encore, on remplit ET on enregistre la
      // note proposée par l'IA (détail des articles + contexte). On n'écrase
      // jamais une note saisie par l'utilisateur. Le libellé d'une ligne
      // existante n'est pas modifié (il s'édite directement dans le tableau).
      if (!note.trim() && res.summary.note) {
        setNote(res.summary.note)
        await updateEntry({ entryId: entry._id, note: res.summary.note })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'analyse.")
    } finally {
      setAnalyzing(false)
    }
  }

  async function applyDetected() {
    if (detected === null) return
    await updateEntry({ entryId: entry._id, real: detected })
    setDetected(null)
  }

  async function handleDelete() {
    await removeEntry({ entryId: entry._id })
    onClose()
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
                backgroundColor: `${sectionColor}1a`,
                color: sectionColor,
              }}
            >
              {sectionLabel}
            </span>
            <h2 className="font-semibold">{entry.label || '(sans libellé)'}</h2>
          </div>
          <button className="app-btn-ghost px-2" onClick={onClose} title="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto p-5">
          {/* Montants */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-md border border-border p-2">
              <p className="text-xs text-muted-foreground">Prévu</p>
              <p className="font-semibold tabular-nums">{formatEUR(entry.budget)}</p>
            </div>
            <div className="rounded-md border border-border p-2">
              <p className="text-xs text-muted-foreground">Réel</p>
              <p className="font-semibold tabular-nums">{formatEUR(entry.real)}</p>
            </div>
            <div className="rounded-md border border-border p-2">
              <p className="text-xs text-muted-foreground">Écart</p>
              <p className="font-semibold tabular-nums">{formatEUR(ecart)}</p>
            </div>
          </div>

          {/* Photo justificative */}
          <div className="rounded-md border border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">Photo / justificatif</span>
              <div className="flex gap-2">
                <label className="app-btn-ghost cursor-pointer px-2 text-xs">
                  <ImagePlus className="h-3.5 w-3.5" />
                  {photoUrl ? 'Remplacer' : 'Attacher'}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleAttach}
                  />
                </label>
                {(photoUrl || freshImage) && (
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

            {uploading ? (
              <p className="text-sm text-muted-foreground">Envoi de la photo…</p>
            ) : photoUrl ? (
              <a href={photoUrl} target="_blank" rel="noreferrer" className="block">
                <img
                  src={photoUrl}
                  alt="Justificatif"
                  className="max-h-48 w-full rounded object-contain"
                />
                <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <ExternalLink className="h-3 w-3" /> Ouvrir en grand
                </span>
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">
                Aucune photo. Attachez un ticket / une facture.
              </p>
            )}

            {/* Résultat d'analyse */}
            {detected !== null && (
              <div className="mt-2 flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
                <span>
                  Montant détecté :{' '}
                  <strong className="tabular-nums">{formatEUR(detected)}</strong>
                </span>
                <button className="app-btn-primary px-3 py-1 text-xs" onClick={applyDetected}>
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
              <div className="flex gap-2">
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
                {noteDirty && (
                  <button
                    className="app-btn-primary px-2 text-xs"
                    onClick={handleSaveNote}
                    disabled={savingNote}
                  >
                    <Save className="h-3.5 w-3.5" /> Enregistrer
                  </button>
                )}
              </div>
            </div>
            <textarea
              className="app-input min-h-20"
              placeholder="Ajouter une note (ou utilisez le micro)…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => {
                if (noteDirty) void handleSaveNote()
              }}
            />
            {speech.listening && (
              <p className="mt-1 text-xs text-destructive">🎙️ Écoute en cours…</p>
            )}
          </div>

          {/* Tags (séparés par des virgules) */}
          <div className="rounded-md border border-border p-3">
            <span className="mb-2 block text-sm font-medium">Tags</span>
            <input
              className="app-input"
              placeholder="Ex. vacances, pro, urgent"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              onBlur={handleSaveTags}
            />
          </div>
        </div>

        {/* Pied : actions */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <button className="app-btn-danger" onClick={handleDelete}>
            <Trash2 className="h-4 w-4" /> Supprimer
          </button>
          <button className="app-btn-primary" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  )
}
