import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { formatMoney } from './budget'

/**
 * Hook d'accès à la DEVISE de l'espace budget courant (propriétaire effectif).
 *
 * Calqué sur `useSections()` : lit `api.settings.getCurrency` (qui résout la
 * devise du propriétaire effectif côté serveur) et fournit un `format()` prêt à
 * l'emploi. Repli 'EUR' tant que la requête charge ou si aucune devise n'est
 * définie — l'affichage reste donc identique au comportement historique.
 *
 * Exemple :
 *   const { format } = useCurrency()
 *   <span>{format(entry.real)}</span> // "6 043 FCFA" si la devise est XAF
 */
export function useCurrency() {
  const currency = useQuery(api.settings.getCurrency) as string | undefined
  const code = currency ?? 'EUR'
  return {
    /** Code ISO 4217 de la devise active (ex. 'EUR', 'USD', 'XAF'). */
    currency: code,
    /** true tant que la requête n'a pas répondu. */
    loading: currency === undefined,
    /** Formate un montant dans la devise active (format français). */
    format: (value: number) => formatMoney(value, code),
  }
}
