/**
 * Composants de SKELETON (placeholders animés affichés pendant le chargement).
 *
 * Remplacent les anciens textes « Chargement… » par des blocs gris pulsants qui
 * esquissent la forme du contenu à venir (meilleure perception de rapidité).
 * S'appuient sur la couleur de thème `bg-muted` (claire/sombre automatiquement)
 * et l'animation utilitaire `animate-pulse` de Tailwind.
 */

/** Bloc de base : un rectangle gris animé. Taille via `className` ou `style`. */
export function Skeleton({
  className = '',
  style,
}: {
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div
      className={`animate-pulse rounded-md bg-muted ${className}`}
      style={style}
      aria-hidden="true"
    />
  )
}

/**
 * Carte (`app-card`) esquissée : un titre + quelques lignes de texte.
 * Réutilisée pour les pages à base de cartes (profil, partage…).
 */
export function SkeletonCard({
  lines = 3,
  className = '',
}: {
  lines?: number
  className?: string
}) {
  return (
    <div className={`app-card flex flex-col gap-3 p-4 ${className}`}>
      <Skeleton className="h-5 w-40" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  )
}

/**
 * Grille de cartes « statistique » esquissées (libellé + grand chiffre).
 * Sert aux KPI du tableau de bord et aux cartes de résumé d'un mois.
 */
export function SkeletonStatCards({
  count = 4,
  className = 'grid gap-4 sm:grid-cols-2 lg:grid-cols-4',
}: {
  count?: number
  className?: string
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="app-card flex flex-col gap-3 p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-32" />
        </div>
      ))}
    </div>
  )
}

/**
 * Carte de graphique esquissée : un titre + une grande zone (hauteur `h`).
 */
export function SkeletonChartCard({ height = 280 }: { height?: number }) {
  return (
    <div className="app-card flex flex-col gap-4 p-5">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="w-full" style={{ height }} />
    </div>
  )
}

/**
 * Lignes esquissées pour un tableau : `rows` lignes × `cols` cellules.
 * La première cellule est plus large (libellé), les suivantes plus étroites.
 */
export function SkeletonTableRows({
  rows = 3,
  cols = 3,
}: {
  rows?: number
  cols?: number
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="border-t border-border/60">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c} className="px-4 py-3">
              <Skeleton className={c === 0 ? 'h-4 w-40' : 'ml-auto h-4 w-16'} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
