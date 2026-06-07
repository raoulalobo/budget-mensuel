import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * Sélecteur d'année réutilisable : ◀ {année} ▶.
 *
 * Utilisé sur la page Mois et le tableau de bord pour naviguer d'une année à
 * l'autre. Purement présentational : il remonte la nouvelle année via `onChange`,
 * la gestion de l'état (année courante) reste dans la page parente.
 */
export default function YearSelector({
  year,
  onChange,
}: {
  year: number
  onChange: (year: number) => void
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1">
      <button
        className="app-btn-ghost px-2"
        onClick={() => onChange(year - 1)}
        title="Année précédente"
        aria-label="Année précédente"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[3.5rem] text-center font-semibold tabular-nums">
        {year}
      </span>
      <button
        className="app-btn-ghost px-2"
        onClick={() => onChange(year + 1)}
        title="Année suivante"
        aria-label="Année suivante"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}
