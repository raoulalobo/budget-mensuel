import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import {
  AlertTriangle,
  Camera,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eraser,
  FileDown,
  Info,
  Loader2,
  Paperclip,
  Plus,
  Repeat,
  Search,
  Sparkles,
  StickyNote,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { monthName } from '../lib/budget'
import { useCurrency } from '../lib/useCurrency'
import { type SectionDef } from '../lib/useSections'
import { generateMonthPdf } from '../lib/pdf'
import { useBudgetRole } from '../lib/budgetRole'
import SummaryCards from './SummaryCards'
import { Skeleton, SkeletonStatCards } from './Skeleton'
import SmartImportDialog from './SmartImportDialog'
import PhotoImportDialog from './PhotoImportDialog'
import EntryDetailDialog from './EntryDetailDialog'
import AddEntryDialog from './AddEntryDialog'
import MonthRecapDialog from './MonthRecapDialog'

/**
 * Vue détaillée d'un mois : reproduit l'onglet mensuel de la feuille.
 *
 * Affiche :
 *  - une barre de navigation (mois précédent / suivant + titre)
 *  - les cartes de résumé (Revenus / Dépenses / NET)
 *  - une carte par section (Revenus, Dépenses fixes, variables, Crédits, Épargne)
 *    avec édition inline (libellé, budget, réel), ajout et suppression de lignes.
 *
 * Toutes les écritures passent par des mutations Convex : l'affichage se met à
 * jour automatiquement (temps réel) sans rechargement.
 */
export default function MonthView({
  year,
  month,
}: {
  year: number
  month: number
}) {
  // Devise de l'espace budget courant (repli EUR pendant le chargement) :
  // `fmt` pour l'affichage, `currency` (code) pour transmettre au PDF.
  const { format: fmt, currency } = useCurrency()
  // `undefined` = en cours de chargement ; `null` = le mois n'existe pas encore.
  const data = useQuery(api.budget.getMonth, { year, month })
  const ensureMonth = useMutation(api.budget.ensureMonth)
  const duplicateMonth = useMutation(api.budget.duplicateMonth)
  const applyRecurring = useMutation(api.recurring.applyRecurring)
  const navigate = useNavigate()
  // Droit d'écriture sur l'espace budget actif (faux pour un lecteur invité).
  const { canEdit } = useBudgetRole()

  // État local : dialogues d'import (CSV / photo / récap) + message ponctuel (toast).
  const [importOpen, setImportOpen] = useState(false)
  const [photoOpen, setPhotoOpen] = useState(false)
  const [recapOpen, setRecapOpen] = useState(false)
  const [addSectionOpen, setAddSectionOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Navigation : passage d'année aux bornes (janvier ← déc année précédente,
  // décembre → jan année suivante).
  const prev =
    month > 1 ? { year, month: month - 1 } : { year: year - 1, month: 12 }
  const next =
    month < 12 ? { year, month: month + 1 } : { year: year + 1, month: 1 }

  /** Duplique le mois courant vers le mois suivant puis y navigue. */
  async function handleDuplicate() {
    if (!next || !data) return
    const res = await duplicateMonth({
      sourceMonthId: data.month._id,
      targetYear: next.year,
      targetMonth: next.month,
    })
    if (res.duplicated) {
      navigate({
        to: '/mois/$year/$month',
        params: { year: String(next.year), month: String(next.month) },
      })
    } else {
      setNotice(res.reason ?? 'Duplication impossible')
      setTimeout(() => setNotice(null), 4000)
    }
  }

  /** Applique les lignes récurrentes au mois courant (ajoute les manquantes). */
  async function handleApplyRecurring() {
    if (!data) return
    const res = await applyRecurring({ monthId: data.month._id })
    setNotice(
      res.added > 0
        ? `${res.added} ligne(s) récurrente(s) ajoutée(s)`
        : 'Aucune nouvelle ligne récurrente (déjà présentes ou aucune définie)',
    )
    setTimeout(() => setNotice(null), 4000)
  }

  /** Génère le bilan PDF du mois courant (rubriques dynamiques). */
  function handleExportPdf() {
    if (!data) return
    generateMonthPdf({
      title: `${monthName(month)} ${year}`,
      summary: data.summary,
      currency,
      sections: data.sections.map((section) => ({
        label: section.label,
        rows: data.entries
          .filter((e) => e.section === section.key)
          .map((e) => ({ label: e.label, budget: e.budget, real: e.real })),
      })),
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* En-tête : navigation entre les mois */}
      <div className="flex items-center justify-between">
        <NavArrow target={prev} dir="prev" />
        <div className="text-center">
          <h1 className="text-2xl font-bold">
            {monthName(month)} {year}
          </h1>
          <p className="text-sm text-muted-foreground">Budget du mois</p>
        </div>
        <NavArrow target={next} dir="next" />
      </div>

      {data === undefined ? (
        // Esquisse pendant le chargement : barre d'actions + cartes + sections.
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-32" />
            ))}
          </div>
          <SkeletonStatCards count={3} className="grid gap-4 sm:grid-cols-3" />
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="app-card flex flex-col gap-3 p-4">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
      ) : data === null ? (
        // Mois pas encore initialisé : proposition de création.
        <div className="app-card flex flex-col items-center gap-4 p-10 text-center">
          <p className="text-muted-foreground">
            Aucune donnée pour {monthName(month)} {year}.
          </p>
          {/* La création d'un mois est une écriture : interdite aux lecteurs. */}
          {canEdit && (
            <button
              className="app-btn-primary"
              onClick={() => void ensureMonth({ year, month })}
            >
              <Plus className="h-4 w-4" /> Créer ce mois
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Barre d'actions : import CSV, duplication, export PDF */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Actions d'ÉCRITURE : masquées pour un lecteur invité. */}
            {canEdit && (
              <>
                <button className="app-btn-ghost" onClick={() => setImportOpen(true)}>
                  <Upload className="h-4 w-4" /> Importer un fichier
                </button>
                <button className="app-btn-ghost" onClick={() => setPhotoOpen(true)}>
                  <Camera className="h-4 w-4" /> Importer par photo
                </button>
                {next && (
                  <button className="app-btn-ghost" onClick={handleDuplicate}>
                    <Copy className="h-4 w-4" /> Dupliquer vers {monthName(next.month)}
                  </button>
                )}
                <button
                  className="app-btn-ghost"
                  onClick={() => void handleApplyRecurring()}
                >
                  <Repeat className="h-4 w-4" /> Lignes récurrentes
                </button>
              </>
            )}
            {/* Actions de LECTURE : toujours disponibles. */}
            <button className="app-btn-ghost" onClick={() => setRecapOpen(true)}>
              <Sparkles className="h-4 w-4" /> Récap IA
            </button>
            <button className="app-btn-ghost" onClick={handleExportPdf}>
              <FileDown className="h-4 w-4" /> Exporter PDF
            </button>
            {notice && (
              <span className="rounded-md bg-amber-100 px-3 py-1 text-sm text-amber-800">
                {notice}
              </span>
            )}
          </div>

          <SummaryCards summary={data.summary} />

          {/*
            Alertes de dépassement : on repère les lignes de DÉPENSE dont le réel
            dépasse le prévu, puis on additionne le surplus total. Une bannière
            ambre résume le nombre de postes concernés et le dépassement cumulé.
          */}
          {(() => {
            // Clés de rubrique « Dépense » (pour repérer les dépassements).
            const expenseKeys = new Set(
              data.sections.filter((s) => s.kind === 'expense').map((s) => s.key),
            )
            const overspent = data.entries.filter(
              (e) => expenseKeys.has(e.section) && e.real > e.budget,
            )
            if (overspent.length === 0) return null
            const total = overspent.reduce((s, e) => s + (e.real - e.budget), 0)
            return (
              <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  <strong>
                    {overspent.length} poste{overspent.length > 1 ? 's' : ''} en
                    dépassement
                  </strong>{' '}
                  — total dépassé :{' '}
                  <strong className="tabular-nums">+{fmt(total)}</strong>
                </span>
              </div>
            )
          })()}

          {/* Prévision : reste à dépenser + net projeté si le budget est tenu */}
          <div className="app-card flex flex-wrap items-center gap-x-8 gap-y-2 px-5 py-3 text-sm">
            <span className="text-muted-foreground">Prévision du mois</span>
            <span>
              Reste à dépenser :{' '}
              <strong className="tabular-nums">
                {fmt(
                  Math.max(0, data.summary.expenseBudget - data.summary.expenseReal),
                )}
              </strong>
            </span>
            <span>
              Net projeté (budget tenu) :{' '}
              <strong
                className="tabular-nums"
                style={{ color: data.summary.netBudget >= 0 ? '#16a34a' : '#dc2626' }}
              >
                {fmt(data.summary.netBudget)}
              </strong>
            </span>
          </div>

          {/* Recherche / filtre des lignes (libellé ou tag) */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className="app-input pl-9"
              placeholder="Rechercher une ligne (libellé, note ou tag)…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Une carte par RUBRIQUE (dynamique, filtrée par la recherche). */}
          <div className="grid gap-6">
            {data.sections.map((section) => (
              <SectionCard
                key={section.key}
                section={section}
                monthId={data.month._id}
                canEdit={canEdit}
                entries={data.entries
                  .filter((e) => e.section === section.key)
                  .filter((e) => matchSearch(e, search))}
              />
            ))}
          </div>

          {/* Création d'une nouvelle rubrique (écriture). */}
          {canEdit && (
            <button
              className="app-btn-ghost w-full justify-center border border-dashed border-border py-3"
              onClick={() => setAddSectionOpen(true)}
            >
              <Plus className="h-4 w-4" /> Nouvelle rubrique
            </button>
          )}
          {addSectionOpen && (
            <AddSectionDialog onClose={() => setAddSectionOpen(false)} />
          )}

          {/* Dialogue d'import intelligent (xls/xlsx/csv + agent IA) */}
          {importOpen && (
            <SmartImportDialog
              monthId={data.month._id}
              monthLabel={`${monthName(month)} ${year}`}
              onClose={() => setImportOpen(false)}
            />
          )}

          {/* Dialogue d'import par photo (analyse vision) */}
          {photoOpen && (
            <PhotoImportDialog
              monthId={data.month._id}
              monthLabel={`${monthName(month)} ${year}`}
              onClose={() => setPhotoOpen(false)}
            />
          )}

          {/* Modale de récap IA du mois */}
          {recapOpen && (
            <MonthRecapDialog
              year={year}
              month={month}
              monthLabel={`${monthName(month)} ${year}`}
              onClose={() => setRecapOpen(false)}
            />
          )}
        </>
      )}
    </div>
  )
}

/** Flèche de navigation vers le mois adjacent (désactivée aux bornes). */
function NavArrow({
  target,
  dir,
}: {
  target: { year: number; month: number } | null
  dir: 'prev' | 'next'
}) {
  const Icon = dir === 'prev' ? ChevronLeft : ChevronRight
  if (!target) {
    return <span className="app-btn-ghost pointer-events-none opacity-30"><Icon className="h-5 w-5" /></span>
  }
  return (
    <Link
      to="/mois/$year/$month"
      params={{ year: String(target.year), month: String(target.month) }}
      className="app-btn-ghost"
      title={monthName(target.month)}
    >
      <Icon className="h-5 w-5" />
    </Link>
  )
}

/** Type d'une ligne tel que renvoyé par Convex (sous-ensemble utilisé ici). */
interface Entry {
  _id: Id<'entries'>
  label: string
  budget: number
  real: number
  section: string
  note?: string
  receiptId?: Id<'receipts'>
  tags?: string[]
}

/** Une ligne correspond-elle à la recherche (libellé ou tag) ? */
function matchSearch(entry: Entry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (entry.label.toLowerCase().includes(q)) return true
  // La note (détail de facture, marchand, date…) est aussi fouillée.
  if (entry.note && entry.note.toLowerCase().includes(q)) return true
  return (entry.tags ?? []).some((t) => t.toLowerCase().includes(q))
}

/**
 * Carte d'une section : tableau de lignes + sous-total + formulaire d'ajout.
 */
function SectionCard({
  section,
  monthId,
  entries,
  canEdit,
}: {
  section: SectionDef
  monthId: Id<'months'>
  entries: Entry[]
  canEdit: boolean
}) {
  // Devise de l'espace budget courant (pour les sous-totaux de la rubrique).
  const { format: fmt } = useCurrency()
  // Ligne dont le détail est ouvert (re-dérivée depuis `entries` pour rester à jour).
  const [selectedId, setSelectedId] = useState<Id<'entries'> | null>(null)
  const selected = entries.find((e) => e._id === selectedId) ?? null
  // Modale d'ajout d'une ligne.
  const [addOpen, setAddOpen] = useState(false)
  // Confirmation de suppression de la rubrique.
  const [deleteOpen, setDeleteOpen] = useState(false)
  // Confirmation de vidage des lignes de la rubrique (ce mois uniquement).
  const [clearOpen, setClearOpen] = useState(false)

  // Sous-totaux de la section.
  const totals = entries.reduce(
    (acc, e) => ({ budget: acc.budget + e.budget, real: acc.real + e.real }),
    { budget: 0, real: 0 },
  )
  // Pour les dépenses on calcule l'écart budget − réel (positif = économie).
  const isExpense = section.kind === 'expense'

  return (
    <section className="app-card overflow-hidden">
      {/* En-tête de rubrique avec pastille de couleur */}
      <header
        className="flex items-center gap-2 border-b border-border px-4 py-3"
        style={{ borderLeft: `4px solid ${section.color}` }}
      >
        <span
          className="app-badge"
          style={{
            backgroundColor: `${section.color}1a`,
            color: section.color,
          }}
        >
          {section.label}
        </span>
        <span className="ml-auto text-sm text-muted-foreground">
          {entries.length} ligne{entries.length > 1 ? 's' : ''}
        </span>
        {/* Vidage des lignes de la rubrique pour CE mois (écriture).
            Disponible aussi sur les rubriques par défaut, contrairement à la
            suppression de rubrique ci-dessous. */}
        {canEdit && entries.length > 0 && (
          <button
            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            title="Vider les lignes de cette rubrique pour ce mois"
            onClick={() => setClearOpen(true)}
          >
            <Eraser className="h-4 w-4" />
          </button>
        )}
        {/* Suppression d'une rubrique non par défaut (écriture). */}
        {canEdit && !section.builtin && (
          <button
            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            title="Supprimer cette rubrique"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </header>

      {/* Tableau */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Poste</th>
              <th className="w-32 px-4 py-2 text-right font-medium">Prévu</th>
              <th className="w-32 px-4 py-2 text-right font-medium">Réel</th>
              <th className="w-32 px-4 py-2 text-right font-medium">Écart</th>
              <th className="w-24 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-3 text-center text-muted-foreground"
                >
                  Aucune ligne — ajoutez-en une ci-dessous.
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <EntryRow
                  key={entry._id}
                  entry={entry}
                  isExpense={isExpense}
                  canEdit={canEdit}
                  onOpenDetail={() => setSelectedId(entry._id)}
                />
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-semibold">
              <td className="px-4 py-2">Total {section.label}</td>
              <td className="px-4 py-2 text-right tabular-nums">
                {fmt(totals.budget)}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                {fmt(totals.real)}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                <Diff value={totals.budget - totals.real} isExpense={isExpense} />
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Bouton d'ajout : ouvre la modale d'ajout complète (écriture). */}
      {canEdit && (
        <div className="border-t border-border px-4 py-3">
          <button
            className="app-btn-ghost w-full justify-center border border-dashed border-border"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="h-4 w-4" /> Ajouter une ligne
          </button>
        </div>
      )}

      {/* Détail de la ligne sélectionnée (libellé/couleur de rubrique passés). */}
      {selected && (
        <EntryDetailDialog
          entry={selected}
          sectionLabel={section.label}
          sectionColor={section.color}
          onClose={() => setSelectedId(null)}
        />
      )}

      {/* Modale d'ajout d'une ligne (rubrique courante). */}
      {addOpen && (
        <AddEntryDialog
          monthId={monthId}
          section={section}
          onClose={() => setAddOpen(false)}
        />
      )}

      {/* Confirmation de suppression de la rubrique (+ ses lignes). */}
      {deleteOpen && (
        <DeleteSectionDialog
          section={section}
          onClose={() => setDeleteOpen(false)}
        />
      )}

      {/* Confirmation de vidage des lignes de la rubrique (ce mois). */}
      {clearOpen && (
        <ClearSectionDialog
          section={section}
          monthId={monthId}
          count={entries.length}
          onClose={() => setClearOpen(false)}
        />
      )}
    </section>
  )
}

/**
 * Une ligne éditable : libellé + montants prévu/réel modifiables en place.
 * La valeur locale est commitée vers Convex au `blur` (perte de focus).
 */
function EntryRow({
  entry,
  isExpense,
  canEdit,
  onOpenDetail,
}: {
  entry: Entry
  isExpense: boolean
  canEdit: boolean
  onOpenDetail: () => void
}) {
  const updateEntry = useMutation(api.budget.updateEntry)
  const removeEntry = useMutation(api.budget.removeEntry)
  // Devise de l'espace budget courant (pour l'aria-label de dépassement).
  const { format: fmt } = useCurrency()

  // États locaux pour une saisie fluide (sinon chaque frappe = une mutation).
  const [label, setLabel] = useState(entry.label)
  const [budget, setBudget] = useState(String(entry.budget))
  const [real, setReal] = useState(String(entry.real))

  // Dépassement : dépense dont le réel excède le prévu (surligne la ligne).
  const overspent = isExpense && entry.real > entry.budget

  return (
    <tr className="border-t border-border/60 hover:bg-accent/40">
      <td className="px-4 py-1.5">
        <input
          className="w-full bg-transparent px-1 py-1 outline-none focus:rounded focus:bg-background read-only:cursor-default"
          value={label}
          readOnly={!canEdit}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => {
            if (label !== entry.label) void updateEntry({ entryId: entry._id, label })
          }}
        />
        {entry.tags && entry.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 px-1">
            {entry.tags.map((t) => (
              <span
                key={t}
                className="app-badge bg-muted px-1.5 py-0 text-[10px] text-muted-foreground"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="px-2 py-1.5">
        <AmountInput
          value={budget}
          readOnly={!canEdit}
          onChange={setBudget}
          onCommit={(n) => {
            if (n !== entry.budget) void updateEntry({ entryId: entry._id, budget: n })
          }}
        />
      </td>
      <td className="px-2 py-1.5">
        <AmountInput
          value={real}
          readOnly={!canEdit}
          onChange={setReal}
          onCommit={(n) => {
            if (n !== entry.real) void updateEntry({ entryId: entry._id, real: n })
          }}
        />
      </td>
      <td className="px-4 py-1.5 text-right tabular-nums">
        <Diff value={entry.budget - entry.real} isExpense={isExpense} />
      </td>
      <td className="px-2 py-1.5">
        <div className="flex items-center justify-end gap-1">
          {/* Indicateur : dépense en dépassement (réel > prévu) */}
          {overspent && (
            <AlertTriangle
              className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400"
              aria-label={`Dépassement de ${fmt(entry.real - entry.budget)}`}
            />
          )}
          {/* Indicateurs : photo jointe / note présente */}
          {entry.receiptId && (
            <Paperclip
              className="h-3.5 w-3.5 text-muted-foreground"
              aria-label="Photo jointe"
            />
          )}
          {entry.note && entry.note.trim() && (
            <StickyNote
              className="h-3.5 w-3.5 text-muted-foreground"
              aria-label="Note"
            />
          )}
          {/* Ouvrir le détail */}
          <button
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Détails (note, photo…)"
            onClick={onOpenDetail}
          >
            <Info className="h-4 w-4" />
          </button>
          {/* Supprimer (écriture : masqué pour les lecteurs) */}
          {canEdit && (
            <button
              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              title="Supprimer la ligne"
              onClick={() => void removeEntry({ entryId: entry._id })}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

/** Champ de saisie d'un montant (nombre), aligné à droite, commit au blur. */
function AmountInput({
  value,
  onChange,
  onCommit,
  readOnly = false,
}: {
  value: string
  onChange: (v: string) => void
  onCommit: (n: number) => void
  readOnly?: boolean
}) {
  return (
    <input
      type="number"
      step="0.01"
      inputMode="decimal"
      className="w-full rounded bg-transparent px-1 py-1 text-right tabular-nums outline-none focus:bg-background read-only:cursor-default"
      value={value}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit(Number(value) || 0)}
    />
  )
}

/**
 * Modale de création d'une RUBRIQUE : nom + type (Revenu / Dépense).
 * Les colonnes (prévu/réel/écart) sont les mêmes pour toutes les rubriques.
 */
function AddSectionDialog({ onClose }: { onClose: () => void }) {
  const createSection = useMutation(api.sections.createSection)
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<'income' | 'expense'>('expense')
  const [busy, setBusy] = useState(false)

  async function handleCreate() {
    const name = label.trim()
    if (!name) return
    setBusy(true)
    try {
      await createSection({ label: name, kind })
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
      <div className="app-card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Nouvelle rubrique</h2>
          <button className="app-btn-ghost px-2" onClick={onClose} title="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="block text-sm font-medium">Nom</label>
        <input
          autoFocus
          className="app-input mt-1"
          placeholder="Ex. Loisirs, Revenus locatifs…"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />

        <p className="mt-4 text-sm font-medium">Type</p>
        <div className="mt-1 flex gap-2">
          {(['expense', 'income'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={
                kind === k
                  ? 'app-btn flex-1 bg-accent text-accent-foreground'
                  : 'app-btn-ghost flex-1 border border-border'
              }
            >
              {k === 'expense' ? 'Dépense' : 'Revenu'}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Le type sert au calcul du Net (Revenus − Dépenses).
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button className="app-btn-ghost" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button
            className="app-btn-primary"
            onClick={() => void handleCreate()}
            disabled={busy || !label.trim()}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Créer
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Confirmation de SUPPRESSION d'une rubrique : indique le nombre de lignes/mois
 * impactés (irréversible — supprime aussi les lignes et les modèles récurrents).
 */
function DeleteSectionDialog({
  section,
  onClose,
}: {
  section: SectionDef
  onClose: () => void
}) {
  const usage = useQuery(api.sections.sectionUsage, { key: section.key })
  const removeSection = useMutation(api.sections.removeSection)
  const [busy, setBusy] = useState(false)

  async function handleDelete() {
    setBusy(true)
    try {
      await removeSection({ id: section._id })
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
      <div className="app-card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <h2 className="font-semibold">Supprimer « {section.label} » ?</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {usage === undefined ? (
            'Vérification des lignes concernées…'
          ) : usage.lines > 0 ? (
            <>
              Cette rubrique contient <strong>{usage.lines} ligne(s)</strong> dans{' '}
              <strong>{usage.months} mois</strong>. Elles seront{' '}
              <strong>définitivement supprimées</strong> (ainsi que les modèles
              récurrents associés).
            </>
          ) : (
            'Cette rubrique ne contient aucune ligne. Action définitive.'
          )}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="app-btn-ghost" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button
            className="app-btn-danger"
            onClick={() => void handleDelete()}
            disabled={busy}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Supprimer définitivement
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Confirmation de VIDAGE d'une rubrique pour le mois courant : supprime toutes
 * les lignes de la section dans CE mois uniquement (mutation
 * `budget.clearSectionEntries`). La rubrique elle-même et ses lignes des autres
 * mois sont conservées — à ne pas confondre avec `DeleteSectionDialog`.
 */
function ClearSectionDialog({
  section,
  monthId,
  count,
  onClose,
}: {
  section: SectionDef
  monthId: Id<'months'>
  count: number
  onClose: () => void
}) {
  const clearSection = useMutation(api.budget.clearSectionEntries)
  const [busy, setBusy] = useState(false)

  async function handleClear() {
    setBusy(true)
    try {
      await clearSection({ monthId, section: section.key })
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
      <div className="app-card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <h2 className="font-semibold">Vider « {section.label} » ?</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Les <strong>{count} ligne{count > 1 ? 's' : ''}</strong> de cette
          rubrique pour ce mois seront{' '}
          <strong>définitivement supprimée{count > 1 ? 's' : ''}</strong>. Les
          autres mois ne sont pas affectés.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="app-btn-ghost" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button
            className="app-btn-danger"
            onClick={() => void handleClear()}
            disabled={busy}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eraser className="h-4 w-4" />}
            Vider
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Affiche un écart coloré.
 * Pour une dépense : écart positif (on a dépensé moins que prévu) = vert.
 * Pour un revenu : écart positif (on a gagné moins que prévu) = rouge.
 */
function Diff({ value, isExpense }: { value: number; isExpense: boolean }) {
  // Devise de l'espace budget courant (pour l'écart affiché).
  const { format: fmt } = useCurrency()
  if (Math.abs(value) < 0.005) {
    return <span className="text-muted-foreground">—</span>
  }
  const favorable = isExpense ? value > 0 : value < 0
  return (
    <span className={favorable ? 'text-emerald-600' : 'text-red-600'}>
      {value > 0 ? '+' : ''}
      {fmt(value)}
    </span>
  )
}
