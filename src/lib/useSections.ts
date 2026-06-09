import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'

/**
 * Définition d'une RUBRIQUE (section) telle que stockée côté serveur.
 * `key` est l'identifiant stable rangé dans `entries.section` ; `kind` indique
 * si la rubrique compte comme Revenu ou Dépense (pour le Net).
 */
export interface SectionDef {
  _id: Id<'sections'>
  key: string
  label: string
  color: string
  kind: 'income' | 'expense'
  order: number
  builtin: boolean
}

/**
 * Hook d'accès aux rubriques du propriétaire effectif (espace budget courant).
 *
 * Remplace les anciennes constantes codées en dur (SECTIONS/SECTION_LABELS/…).
 * Fournit la liste ordonnée + des helpers de résolution par clé.
 */
export function useSections() {
  const sections = useQuery(api.sections.listSections) as
    | SectionDef[]
    | undefined
  const list = sections ?? []
  const byKey = new Map(list.map((s) => [s.key, s]))
  return {
    sections: list,
    loading: sections === undefined,
    byKey,
    /** Libellé d'une clé (repli sur la clé si inconnue). */
    label: (key: string) => byKey.get(key)?.label ?? key,
    /** Couleur d'une clé (repli neutre). */
    color: (key: string) => byKey.get(key)?.color ?? '#888888',
    /** Une clé est-elle une DÉPENSE ? (par défaut oui si inconnue). */
    isExpense: (key: string) => byKey.get(key)?.kind !== 'income',
  }
}
