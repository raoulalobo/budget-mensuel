import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileDown,
  Info,
  Paperclip,
  Plus,
  StickyNote,
  Trash2,
  Upload,
} from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  EXPENSE_SECTIONS,
  SECTION_COLORS,
  SECTION_LABELS,
  SECTIONS,
  formatEUR,
  monthName,
  type Section,
} from '../lib/budget'
import { generateMonthPdf } from '../lib/pdf'
import SummaryCards from './SummaryCards'
import ImportDialog from './ImportDialog'
import PhotoImportDialog from './PhotoImportDialog'
import EntryDetailDialog from './EntryDetailDialog'

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
  // `undefined` = en cours de chargement ; `null` = le mois n'existe pas encore.
  const data = useQuery(api.budget.getMonth, { year, month })
  const ensureMonth = useMutation(api.budget.ensureMonth)
  const duplicateMonth = useMutation(api.budget.duplicateMonth)
  const navigate = useNavigate()

  // État local : dialogues d'import (CSV / photo) + message ponctuel (toast).
  const [importOpen, setImportOpen] = useState(false)
  const [photoOpen, setPhotoOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

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

  /** Génère le bilan PDF du mois courant. */
  function handleExportPdf() {
    if (!data) return
    generateMonthPdf({
      title: `${monthName(month)} ${year}`,
      summary: data.summary,
      sections: SECTIONS.map((section) => ({
        label: SECTION_LABELS[section],
        rows: data.entries
          .filter((e) => e.section === section)
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
        <p className="text-muted-foreground">Chargement…</p>
      ) : data === null ? (
        // Mois pas encore initialisé : proposition de création.
        <div className="app-card flex flex-col items-center gap-4 p-10 text-center">
          <p className="text-muted-foreground">
            Aucune donnée pour {monthName(month)} {year}.
          </p>
          <button
            className="app-btn-primary"
            onClick={() => void ensureMonth({ year, month })}
          >
            <Plus className="h-4 w-4" /> Créer ce mois
          </button>
        </div>
      ) : (
        <>
          {/* Barre d'actions : import CSV, duplication, export PDF */}
          <div className="flex flex-wrap items-center gap-2">
            <button className="app-btn-ghost" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" /> Importer CSV
            </button>
            <button className="app-btn-ghost" onClick={() => setPhotoOpen(true)}>
              <Camera className="h-4 w-4" /> Importer par photo
            </button>
            {next && (
              <button className="app-btn-ghost" onClick={handleDuplicate}>
                <Copy className="h-4 w-4" /> Dupliquer vers {monthName(next.month)}
              </button>
            )}
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

          {/* Une carte par section. */}
          <div className="grid gap-6">
            {SECTIONS.map((section) => (
              <SectionCard
                key={section}
                section={section}
                monthId={data.month._id}
                entries={data.entries.filter((e) => e.section === section)}
              />
            ))}
          </div>

          {/* Dialogue d'import CSV */}
          {importOpen && (
            <ImportDialog
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
  section: Section
  note?: string
  receiptId?: Id<'receipts'>
}

/**
 * Carte d'une section : tableau de lignes + sous-total + formulaire d'ajout.
 */
function SectionCard({
  section,
  monthId,
  entries,
}: {
  section: Section
  monthId: Id<'months'>
  entries: Entry[]
}) {
  const addEntry = useMutation(api.budget.addEntry)
  const [newLabel, setNewLabel] = useState('')
  // Ligne dont le détail est ouvert (re-dérivée depuis `entries` pour rester à jour).
  const [selectedId, setSelectedId] = useState<Id<'entries'> | null>(null)
  const selected = entries.find((e) => e._id === selectedId) ?? null

  // Sous-totaux de la section.
  const totals = entries.reduce(
    (acc, e) => ({ budget: acc.budget + e.budget, real: acc.real + e.real }),
    { budget: 0, real: 0 },
  )
  // Pour les dépenses on calcule l'écart budget − réel (positif = économie).
  const isExpense = EXPENSE_SECTIONS.includes(section)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const label = newLabel.trim()
    if (!label) return
    setNewLabel('')
    await addEntry({ monthId, section, label })
  }

  return (
    <section className="app-card overflow-hidden">
      {/* En-tête de section avec pastille de couleur */}
      <header
        className="flex items-center gap-2 border-b border-border px-4 py-3"
        style={{ borderLeft: `4px solid ${SECTION_COLORS[section]}` }}
      >
        <span
          className="app-badge"
          style={{
            backgroundColor: `${SECTION_COLORS[section]}1a`,
            color: SECTION_COLORS[section],
          }}
        >
          {SECTION_LABELS[section]}
        </span>
        <span className="ml-auto text-sm text-muted-foreground">
          {entries.length} ligne{entries.length > 1 ? 's' : ''}
        </span>
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
                  onOpenDetail={() => setSelectedId(entry._id)}
                />
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-semibold">
              <td className="px-4 py-2">Total {SECTION_LABELS[section]}</td>
              <td className="px-4 py-2 text-right tabular-nums">
                {formatEUR(totals.budget)}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                {formatEUR(totals.real)}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                <Diff value={totals.budget - totals.real} isExpense={isExpense} />
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Formulaire d'ajout de ligne */}
      <form
        onSubmit={handleAdd}
        className="flex items-center gap-2 border-t border-border px-4 py-3"
      >
        <input
          className="app-input flex-1"
          placeholder={`Ajouter une ligne dans « ${SECTION_LABELS[section]} »`}
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
        />
        <button type="submit" className="app-btn-primary" disabled={!newLabel.trim()}>
          <Plus className="h-4 w-4" /> Ajouter
        </button>
      </form>

      {/* Détail de la ligne sélectionnée */}
      {selected && (
        <EntryDetailDialog entry={selected} onClose={() => setSelectedId(null)} />
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
  onOpenDetail,
}: {
  entry: Entry
  isExpense: boolean
  onOpenDetail: () => void
}) {
  const updateEntry = useMutation(api.budget.updateEntry)
  const removeEntry = useMutation(api.budget.removeEntry)

  // États locaux pour une saisie fluide (sinon chaque frappe = une mutation).
  const [label, setLabel] = useState(entry.label)
  const [budget, setBudget] = useState(String(entry.budget))
  const [real, setReal] = useState(String(entry.real))

  return (
    <tr className="border-t border-border/60 hover:bg-accent/40">
      <td className="px-4 py-1.5">
        <input
          className="w-full bg-transparent px-1 py-1 outline-none focus:rounded focus:bg-background"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => {
            if (label !== entry.label) void updateEntry({ entryId: entry._id, label })
          }}
        />
      </td>
      <td className="px-2 py-1.5">
        <AmountInput
          value={budget}
          onChange={setBudget}
          onCommit={(n) => {
            if (n !== entry.budget) void updateEntry({ entryId: entry._id, budget: n })
          }}
        />
      </td>
      <td className="px-2 py-1.5">
        <AmountInput
          value={real}
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
          {/* Supprimer */}
          <button
            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            title="Supprimer la ligne"
            onClick={() => void removeEntry({ entryId: entry._id })}
          >
            <Trash2 className="h-4 w-4" />
          </button>
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
}: {
  value: string
  onChange: (v: string) => void
  onCommit: (n: number) => void
}) {
  return (
    <input
      type="number"
      step="0.01"
      inputMode="decimal"
      className="w-full rounded bg-transparent px-1 py-1 text-right tabular-nums outline-none focus:bg-background"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit(Number(value) || 0)}
    />
  )
}

/**
 * Affiche un écart coloré.
 * Pour une dépense : écart positif (on a dépensé moins que prévu) = vert.
 * Pour un revenu : écart positif (on a gagné moins que prévu) = rouge.
 */
function Diff({ value, isExpense }: { value: number; isExpense: boolean }) {
  if (Math.abs(value) < 0.005) {
    return <span className="text-muted-foreground">—</span>
  }
  const favorable = isExpense ? value > 0 : value < 0
  return (
    <span className={favorable ? 'text-emerald-600' : 'text-red-600'}>
      {value > 0 ? '+' : ''}
      {formatEUR(value)}
    </span>
  )
}
