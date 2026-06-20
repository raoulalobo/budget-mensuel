import { useMemo, useState } from 'react'
import { useAction, useMutation } from 'convex/react'
import {
  X,
  Upload,
  FileUp,
  Sparkles,
  Loader2,
  Trash2,
  Plus,
  AlertTriangle,
  Wrench,
  RotateCcw,
} from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useSections } from '../lib/useSections'
import { parseFileToTable, type RawTable } from '../lib/smartImport/parseFile'
import { applyMapping } from '../lib/smartImport/applyMapping'
import type {
  ImportAnswer,
  ImportMapping,
  ImportQuestion,
} from '../lib/smartImport/types'

/**
 * Import intelligent d'un fichier xls/xlsx/csv avec agent IA.
 *
 * Flux (machine à états `step`) :
 *  1. `file`      : l'utilisateur charge un fichier (Excel lu via SheetJS en
 *                   chunk lazy, CSV parsé nativement) — aperçu brut des
 *                   premières lignes, choix de la feuille si classeur.
 *  2. `analyzing` : un échantillon (≤ 20 lignes) part vers l'action Convex
 *                   `importMapping.analyzeImport` (DeepSeek).
 *  3. `questions` : l'IA pose des questions à CHOIX (max 3 tours) pour lever
 *                   les ambiguïtés (colonne des montants, rubrique cible…).
 *  4. `preview`   : le MAPPING renvoyé est appliqué localement à TOUT le
 *                   fichier (`applyMapping`, déterministe) → tableau éditable,
 *                   puis import via la mutation existante `budget.importEntries`.
 *  - `manual`     : repli sans IA (clé absente / échec) : l'utilisateur mappe
 *                   lui-même les colonnes — produit le même `ImportMapping`.
 */

/** Tours de questions maximum côté client (aligné avec l'action Convex). */
const MAX_ROUNDS = 3
/** Lignes d'échantillon envoyées à l'IA. */
const SAMPLE_ROWS = 20
/** Lignes affichées dans l'aperçu éditable (au-delà : compteur "+N"). */
const PREVIEW_LIMIT = 200
/** Seuil au-delà duquel on demande une confirmation explicite. */
const CONFIRM_THRESHOLD = 500

type Step = 'file' | 'analyzing' | 'questions' | 'preview' | 'manual'

/** Une ligne éditable de l'aperçu (montants en string pour une saisie fluide). */
interface EditableRow {
  section: string
  label: string
  budget: string
  real: string
  /** Date ISO 'YYYY-MM-DD' (vide si aucune). */
  date: string
}

/** Libellé de colonne pour les selects du mode manuel : "Colonne 2 — « Montant »". */
function columnLabel(table: RawTable, index: number): string {
  const head = (table.rows[0]?.[index] ?? '').slice(0, 24)
  return head ? `Colonne ${index + 1} — « ${head} »` : `Colonne ${index + 1}`
}

export default function SmartImportDialog({
  monthId,
  monthLabel,
  onClose,
}: {
  monthId: Id<'months'>
  monthLabel: string
  onClose: () => void
}) {
  const analyze = useAction(api.importMapping.analyzeImport)
  const importEntries = useMutation(api.budget.importEntries)
  const { sections } = useSections()

  // Rubrique de repli pour les nouvelles lignes (1re dépense, sinon 1re rubrique).
  const fallbackKey =
    sections.find((s) => s.kind === 'expense')?.key ?? sections[0]?.key ?? ''

  const [step, setStep] = useState<Step>('file')
  const [file, setFile] = useState<File | null>(null)
  const [table, setTable] = useState<RawTable | null>(null)
  const [fatal, setFatal] = useState<string | null>(null) // erreur bloquante affichée

  // — Dialogue avec l'IA —
  const [round, setRound] = useState(1)
  const [answers, setAnswers] = useState<ImportAnswer[]>([])
  const [questions, setQuestions] = useState<ImportQuestion[]>([])
  // Réponses en cours de saisie pour le tour affiché (id question → valeur).
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [aiNotes, setAiNotes] = useState('')
  const [aiConfidence, setAiConfidence] = useState<number | null>(null)

  // — Aperçu / import —
  const [rows, setRows] = useState<EditableRow[]>([])
  const [rowErrors, setRowErrors] = useState<string[]>([])
  const [skipped, setSkipped] = useState(0)
  const [replace, setReplace] = useState(false)
  const [confirmBig, setConfirmBig] = useState(false)
  const [busy, setBusy] = useState(false)
  // Note libre pour « Reconfigurer » (renvoyée à l'IA comme feedback).
  const [feedback, setFeedback] = useState('')

  // — Mode manuel (repli sans IA) —
  const [mLabel, setMLabel] = useState(0)
  const [mBudget, setMBudget] = useState<number | -1>(-1) // -1 = aucune
  const [mReal, setMReal] = useState<number | -1>(1)
  const [mDate, setMDate] = useState<number | -1>(-1) // -1 = aucune colonne date
  const [mSection, setMSection] = useState('')
  const [mHeader, setMHeader] = useState(true)

  /** Nombre de colonnes du tableau chargé (pour les selects du mode manuel). */
  const columnCount = useMemo(
    () => (table ? table.rows.reduce((max, r) => Math.max(max, r.length), 0) : 0),
    [table],
  )

  /** Chargement + parsing du fichier choisi (ou re-lecture d'une autre feuille). */
  async function handleFile(f: File, sheetName?: string) {
    setFatal(null)
    try {
      const t = await parseFileToTable(f, sheetName)
      if (t.rows.length === 0) {
        setFatal('Le fichier ne contient aucune donnée.')
        return
      }
      setFile(f)
      setTable(t)
    } catch (e) {
      setFatal(e instanceof Error ? e.message : 'Fichier illisible.')
    }
  }

  /**
   * Lance (ou poursuit) l'analyse IA : envoie l'échantillon + les réponses
   * cumulées, puis route selon la réponse (questions, mapping ou erreur).
   */
  async function runAnalysis(allAnswers: ImportAnswer[], nextRound: number) {
    if (!table || !file) return
    setStep('analyzing')
    setFatal(null)
    try {
      const sampleRows = table.rows.slice(0, SAMPLE_ROWS)
      const res = await analyze({
        sample: {
          fileName: file.name,
          rows: sampleRows,
          totalRows: table.rows.length,
        },
        sections: sections.map((s) => ({ key: s.key, label: s.label, kind: s.kind })),
        answers: allAnswers,
        round: nextRound,
      })

      if (res.status === 'questions') {
        // Garde client (l'action a la même) : jamais plus de MAX_ROUNDS tours.
        if (nextRound > MAX_ROUNDS) {
          setFatal('L’IA n’a pas réussi à conclure. Utilisez le mode manuel.')
          setStep('file')
          return
        }
        setQuestions(res.questions)
        setDraft({})
        setRound(nextRound)
        setAnswers(allAnswers)
        setStep('questions')
      } else if (res.status === 'mapping') {
        setAiNotes(res.notes)
        setAiConfidence(res.confidence)
        enterPreview(res.mapping)
      } else {
        setFatal(res.error)
        setStep('file')
      }
    } catch (e) {
      setFatal(e instanceof Error ? e.message : 'Échec de l’analyse.')
      setStep('file')
    }
  }

  /** Applique un mapping (IA ou manuel) à tout le fichier et ouvre l'aperçu. */
  function enterPreview(mapping: ImportMapping) {
    if (!table) return
    const res = applyMapping(table.rows, mapping, sections)
    setRows(
      res.entries.map((e) => ({
        section: e.section,
        label: e.label,
        budget: String(e.budget),
        real: String(e.real),
        date: e.date ?? '',
      })),
    )
    setRowErrors(res.errors)
    setSkipped(res.skipped)
    setConfirmBig(false)
    setStep('preview')
  }

  /** Valide le tour de questions courant et relance l'analyse. */
  function submitAnswers() {
    const newAnswers: ImportAnswer[] = [
      ...answers,
      ...questions.map((q) => ({ id: q.id, value: draft[q.id] ?? '' })),
    ]
    void runAnalysis(newAnswers, round + 1)
  }

  /** « Reconfigurer » depuis l'aperçu : repart au tour 1 avec le feedback. */
  function reconfigure() {
    const fb: ImportAnswer[] = feedback.trim()
      ? [{ id: 'user_feedback', value: `Le mapping précédent était incorrect : ${feedback.trim()}` }]
      : [{ id: 'user_feedback', value: 'Le mapping précédent était incorrect, repropose des questions.' }]
    setFeedback('')
    void runAnalysis(fb, 1)
  }

  /** Construit le mapping du mode manuel et ouvre l'aperçu. */
  function applyManual() {
    if (mBudget === -1 && mReal === -1) {
      setFatal('Choisissez au moins une colonne de montant.')
      return
    }
    if (!mSection) {
      setFatal('Choisissez une rubrique cible.')
      return
    }
    setFatal(null)
    enterPreview({
      headerRows: mHeader ? 1 : 0,
      labelColumn: mLabel,
      budgetColumn: mBudget === -1 ? null : mBudget,
      realColumn: mReal === -1 ? null : mReal,
      dateColumn: mDate === -1 ? null : mDate,
      singleAmountTarget: 'both',
      section: { type: 'fixed', key: mSection },
      skipRowIndexes: [],
      ignoreLabelContains: ['total', 'sous-total'],
      signConvention: 'absolute',
    })
    setAiNotes('')
    setAiConfidence(null)
  }

  // Édition du tableau d'aperçu.
  function updateRow(i: number, patch: Partial<EditableRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, idx) => idx !== i))
  }
  function addRow() {
    setRows((rs) => [
      ...rs,
      { section: fallbackKey, label: '', budget: '0', real: '0', date: '' },
    ])
  }

  // Lignes réellement importées (libellé non vide).
  const keptRows = rows.filter((r) => r.label.trim().length > 0)
  const needsConfirm = keptRows.length > CONFIRM_THRESHOLD && !confirmBig

  async function handleImport() {
    if (keptRows.length === 0 || needsConfirm) return
    setBusy(true)
    try {
      await importEntries({
        monthId,
        replace,
        entries: keptRows.map((r) => ({
          section: r.section,
          label: r.label.trim(),
          budget: Number(r.budget) || 0,
          real: Number(r.real) || 0,
          // Date optionnelle : envoyée seulement si renseignée (sinon ligne sans date).
          date: r.date.trim() || undefined,
        })),
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
        className="app-card flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <Sparkles className="h-4 w-4" /> Import intelligent — {monthLabel}
          </h2>
          <button className="app-btn-ghost px-2" onClick={onClose} title="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto p-5">
          {/* Erreur bloquante (IA indisponible, fichier illisible…) */}
          {fatal && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{fatal}</span>
            </div>
          )}

          {/* ÉTAPE 1 : choix du fichier */}
          {step === 'file' && (
            <>
              {!table ? (
                <label className="flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-6 py-10 text-center text-sm text-muted-foreground hover:bg-muted/60">
                  <FileUp className="h-8 w-8" />
                  Cliquez pour choisir un fichier Excel (.xls/.xlsx) ou CSV.
                  <span className="text-xs">
                    L'IA analysera sa structure et vous posera quelques questions
                    si besoin.
                  </span>
                  <input
                    type="file"
                    accept=".csv,.tsv,.txt,.xls,.xlsx,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (f) void handleFile(f)
                    }}
                  />
                </label>
              ) : (
                <>
                  {/* Fichier chargé : nom + changement éventuel */}
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="app-badge">{file?.name}</span>
                    <span className="text-muted-foreground">
                      {table.rows.length} ligne{table.rows.length > 1 ? 's' : ''}
                    </span>
                    <label className="app-btn-ghost cursor-pointer px-2 text-xs">
                      Changer de fichier
                      <input
                        type="file"
                        accept=".csv,.tsv,.txt,.xls,.xlsx,text/csv"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          e.target.value = ''
                          if (f) void handleFile(f)
                        }}
                      />
                    </label>
                  </div>

                  {/* Classeur multi-feuilles : choix local (sans IA) */}
                  {table.sheetNames && table.sheetNames.length > 1 && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm font-medium">Feuille du classeur</label>
                      <select
                        className="app-input"
                        value={table.sheetName}
                        onChange={(e) => {
                          if (file) void handleFile(file, e.target.value)
                        }}
                      >
                        {table.sheetNames.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Mini-aperçu brut des premières lignes */}
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-xs">
                      <tbody>
                        {table.rows.slice(0, 5).map((r, i) => (
                          <tr key={i} className="border-t border-border/60 first:border-t-0">
                            {r.slice(0, 8).map((c, j) => (
                              <td key={j} className="max-w-40 truncate px-2 py-1.5">
                                {c}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      className="app-btn-primary"
                      onClick={() => void runAnalysis([], 1)}
                    >
                      <Sparkles className="h-4 w-4" /> Analyser avec l'IA
                    </button>
                    <button
                      className="app-btn-ghost"
                      onClick={() => {
                        setFatal(null)
                        setMSection(fallbackKey)
                        setStep('manual')
                      }}
                    >
                      <Wrench className="h-4 w-4" /> Mapper manuellement
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* ÉTAPE 2 : analyse en cours */}
          {step === 'analyzing' && (
            <div className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              L'IA analyse la structure du fichier…
            </div>
          )}

          {/* ÉTAPE 3 : questions de l'agent IA */}
          {step === 'questions' && (
            <>
              <p className="text-sm text-muted-foreground">
                L'IA a besoin de précisions pour organiser vos données — tour{' '}
                {round}/{MAX_ROUNDS}.
              </p>
              {questions.map((q) => (
                <fieldset key={q.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
                  <legend className="px-1 text-sm font-medium">{q.text}</legend>
                  {q.options.map((o) => (
                    <label key={o.value} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={q.id}
                        checked={draft[q.id] === o.value}
                        onChange={() =>
                          setDraft((d) => ({ ...d, [q.id]: o.value }))
                        }
                      />
                      {o.label}
                    </label>
                  ))}
                  {q.allowFreeText && (
                    <input
                      className="app-input text-sm"
                      placeholder="Autre réponse (texte libre)…"
                      // Le texte libre écrase le choix radio (et inversement).
                      value={
                        q.options.some((o) => o.value === draft[q.id])
                          ? ''
                          : (draft[q.id] ?? '')
                      }
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, [q.id]: e.target.value }))
                      }
                    />
                  )}
                </fieldset>
              ))}
              <div className="flex gap-2">
                <button
                  className="app-btn-primary"
                  // Toutes les questions doivent avoir une réponse (choix ou texte).
                  disabled={questions.some((q) => !(draft[q.id] ?? '').trim())}
                  onClick={submitAnswers}
                >
                  Continuer
                </button>
                <button
                  className="app-btn-ghost"
                  onClick={() => {
                    setFatal(null)
                    setMSection(fallbackKey)
                    setStep('manual')
                  }}
                >
                  <Wrench className="h-4 w-4" /> Passer en manuel
                </button>
              </div>
            </>
          )}

          {/* MODE MANUEL : mapping minimal sans IA */}
          {step === 'manual' && table && (
            <>
              <p className="text-sm text-muted-foreground">
                Indiquez le rôle des colonnes ; toutes les lignes iront dans la
                rubrique choisie.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Colonne du libellé</label>
                  <select
                    className="app-input"
                    value={mLabel}
                    onChange={(e) => setMLabel(Number(e.target.value))}
                  >
                    {Array.from({ length: columnCount }, (_, i) => (
                      <option key={i} value={i}>
                        {columnLabel(table, i)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Rubrique cible</label>
                  <select
                    className="app-input"
                    value={mSection}
                    onChange={(e) => setMSection(e.target.value)}
                  >
                    {sections.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Colonne « prévu »</label>
                  <select
                    className="app-input"
                    value={mBudget}
                    onChange={(e) => setMBudget(Number(e.target.value))}
                  >
                    <option value={-1}>— Aucune —</option>
                    {Array.from({ length: columnCount }, (_, i) => (
                      <option key={i} value={i}>
                        {columnLabel(table, i)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Colonne « réel »</label>
                  <select
                    className="app-input"
                    value={mReal}
                    onChange={(e) => setMReal(Number(e.target.value))}
                  >
                    <option value={-1}>— Aucune —</option>
                    {Array.from({ length: columnCount }, (_, i) => (
                      <option key={i} value={i}>
                        {columnLabel(table, i)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Colonne « date »</label>
                  <select
                    className="app-input"
                    value={mDate}
                    onChange={(e) => setMDate(Number(e.target.value))}
                  >
                    <option value={-1}>— Aucune —</option>
                    {Array.from({ length: columnCount }, (_, i) => (
                      <option key={i} value={i}>
                        {columnLabel(table, i)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={mHeader}
                  onChange={(e) => setMHeader(e.target.checked)}
                />
                La première ligne est un en-tête (à ignorer)
              </label>
              <div className="flex gap-2">
                <button className="app-btn-primary" onClick={applyManual}>
                  Appliquer
                </button>
                <button className="app-btn-ghost" onClick={() => setStep('file')}>
                  Retour
                </button>
              </div>
            </>
          )}

          {/* ÉTAPE 4 : aperçu éditable + import */}
          {step === 'preview' && (
            <>
              {/* Bandeau notes/confiance de l'IA (absent en mode manuel) */}
              {(aiNotes || aiConfidence !== null) && (
                <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                  {aiConfidence !== null && (
                    <span className="font-medium">
                      Confiance de l'IA : {Math.round(aiConfidence * 100)} %.{' '}
                    </span>
                  )}
                  {aiNotes}
                </div>
              )}

              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">
                  {keptRows.length} ligne{keptRows.length > 1 ? 's' : ''} à importer
                  {skipped > 0 && (
                    <span className="font-normal text-muted-foreground">
                      {' '}
                      ({skipped} ignorée{skipped > 1 ? 's' : ''} : en-têtes, totaux…)
                    </span>
                  )}
                </span>
                <button className="app-btn-ghost px-2 text-xs" onClick={addRow}>
                  <Plus className="h-3.5 w-3.5" /> Ajouter
                </button>
              </div>

              {/* Problèmes ligne par ligne (montants illisibles…) */}
              {rowErrors.length > 0 && (
                <ul className="list-inside list-disc rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-800">
                  {rowErrors.slice(0, 8).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                  {rowErrors.length > 8 && (
                    <li>… et {rowErrors.length - 8} autre(s)</li>
                  )}
                </ul>
              )}

              {rows.length > 0 && (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Rubrique</th>
                        <th className="px-3 py-2 font-medium">Libellé</th>
                        <th className="w-28 px-3 py-2 text-right font-medium">Prévu</th>
                        <th className="w-28 px-3 py-2 text-right font-medium">Réel</th>
                        <th className="w-36 px-3 py-2 font-medium">Date</th>
                        <th className="w-10 px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, PREVIEW_LIMIT).map((row, i) => (
                        <tr key={i} className="border-t border-border/60">
                          <td className="px-2 py-1.5">
                            <select
                              className="w-full rounded border border-input bg-background px-1.5 py-1 outline-none focus:ring-2 focus:ring-ring"
                              value={row.section}
                              onChange={(e) => updateRow(i, { section: e.target.value })}
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
                              value={row.budget}
                              onChange={(e) => updateRow(i, { budget: e.target.value })}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="number"
                              step="0.01"
                              inputMode="decimal"
                              className="w-full rounded bg-transparent px-1 py-1 text-right tabular-nums outline-none focus:bg-background"
                              value={row.real}
                              onChange={(e) => updateRow(i, { real: e.target.value })}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="date"
                              className="w-full rounded bg-transparent px-1 py-1 outline-none focus:bg-background"
                              value={row.date}
                              onChange={(e) => updateRow(i, { date: e.target.value })}
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
                  {rows.length > PREVIEW_LIMIT && (
                    <p className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
                      … et {rows.length - PREVIEW_LIMIT} ligne(s) supplémentaire(s)
                      (toutes seront importées).
                    </p>
                  )}
                </div>
              )}

              {/* Garde-fou gros volumes */}
              {keptRows.length > CONFIRM_THRESHOLD && (
                <label className="flex items-center gap-2 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-800">
                  <input
                    type="checkbox"
                    checked={confirmBig}
                    onChange={(e) => setConfirmBig(e.target.checked)}
                  />
                  Je confirme l'import de {keptRows.length} lignes (volume
                  important).
                </label>
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

              {/* Reconfiguration : feedback libre renvoyé à l'IA (tour 1) */}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="app-input min-w-48 flex-1 text-sm"
                  placeholder="Un problème ? Décrivez-le (ex. « les montants sont en colonne 3 »)…"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                />
                <button className="app-btn-ghost" onClick={reconfigure}>
                  <RotateCcw className="h-4 w-4" /> Reconfigurer
                </button>
              </div>
            </>
          )}
        </div>

        {/* Pied : actions */}
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button className="app-btn-ghost" onClick={onClose}>
            Annuler
          </button>
          {step === 'preview' && (
            <button
              className="app-btn-primary"
              disabled={busy || keptRows.length === 0 || needsConfirm}
              onClick={handleImport}
            >
              <Upload className="h-4 w-4" />
              {busy ? 'Import…' : `Importer ${keptRows.length} ligne(s)`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
