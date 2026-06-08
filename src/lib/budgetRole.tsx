import { createContext, useContext } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'

/**
 * Contexte « rôle sur l'espace budget actif » (BUDGET PARTAGÉ).
 *
 * Fournit à toute l'application le rôle de l'utilisateur sur l'espace
 * actuellement regardé (le sien ou un espace partagé) et, surtout, le drapeau
 * `canEdit` qui sert à (dé)bloquer les contrôles d'écriture côté UI. La sécurité
 * réelle reste assurée côté serveur (`requireWrite` rejette les lecteurs) ; ce
 * contexte n'est qu'une commodité d'affichage.
 *
 * Exemple d'usage :
 *   const { canEdit } = useBudgetRole()
 *   <button disabled={!canEdit}>Ajouter</button>
 */
export interface BudgetRoleValue {
  /** true une fois la requête `currentBudget` résolue. */
  loaded: boolean
  /** L'utilisateur regarde-t-il SON propre espace ? */
  isOwner: boolean
  /** Rôle effectif : propriétaire, éditeur ou lecteur. */
  role: 'owner' | 'editor' | 'viewer'
  /** Peut-il modifier les données (propriétaire ou éditeur) ? */
  canEdit: boolean
  /** Libellé du propriétaire de l'espace (email/nom) — pour les bandeaux. */
  ownerLabel: string
}

// Valeur par défaut « permissive » pendant le chargement : on n'affiche pas de
// blocage tant que le rôle n'est pas connu (le serveur protège de toute façon).
const DEFAULT: BudgetRoleValue = {
  loaded: false,
  isOwner: true,
  role: 'owner',
  canEdit: true,
  ownerLabel: '',
}

const BudgetRoleContext = createContext<BudgetRoleValue>(DEFAULT)

/** Fournit le rôle courant à l'arbre React (à monter sous `Authenticated`). */
export function BudgetRoleProvider({ children }: { children: React.ReactNode }) {
  const cur = useQuery(api.sharing.currentBudget)
  const value: BudgetRoleValue = cur
    ? {
        loaded: true,
        isOwner: cur.isOwner,
        role: cur.role,
        canEdit: cur.canEdit,
        ownerLabel: cur.ownerLabel,
      }
    : DEFAULT
  return (
    <BudgetRoleContext.Provider value={value}>
      {children}
    </BudgetRoleContext.Provider>
  )
}

/** Hook d'accès au rôle courant sur l'espace budget. */
export function useBudgetRole(): BudgetRoleValue {
  return useContext(BudgetRoleContext)
}
