import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { effectiveOwnerOrNull, requireWrite } from './sharing'

/**
 * RÉGLAGES de l'espace budget, scopés au PROPRIÉTAIRE EFFECTIF.
 *
 * Contrairement à `convex/users.ts` (volontairement « self only » : chaque
 * utilisateur gère SON propre compte/profil), la devise est une propriété de
 * l'ESPACE budget : elle suit le propriétaire effectif (via `effectiveOwnerOrNull`
 * / `requireWrite` de `convex/sharing.ts`). Conséquence : un budget partagé a une
 * devise unique, identique pour tous les membres qui le regardent ; seuls les
 * éditeurs (et le propriétaire) peuvent la changer.
 *
 * Aucune conversion : la devise ne fait que ré-étiqueter l'affichage des montants
 * (un budget = une seule devise). Stockage : `userProfiles.currency` du owner.
 */

/**
 * Codes de devise autorisés (ISO 4217). DOIT rester synchronisé avec la liste
 * `CURRENCIES` exposée à l'UI dans `src/lib/budget.ts`. On valide ici côté serveur
 * pour refuser tout code inconnu envoyé par un client.
 */
const ALLOWED_CURRENCIES = new Set([
  'EUR',
  'USD',
  'XAF',
  'XOF',
  'GBP',
  'CHF',
  'CAD',
  'MAD',
])

/** Devise par défaut quand aucune n'est définie (préserve le comportement EUR historique). */
const DEFAULT_CURRENCY = 'EUR'

/**
 * Devise de l'espace budget courant (propriétaire effectif).
 * Renvoie toujours un code valide : `userProfiles.currency` du owner, ou 'EUR'
 * si le profil n'existe pas / n'a pas de devise (nouveau compte, lecture seule…).
 */
export const getCurrency = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await effectiveOwnerOrNull(ctx)
    if (ownerId === null) return DEFAULT_CURRENCY
    const profile = await ctx.db
      .query('userProfiles')
      .withIndex('by_user', (q) => q.eq('userId', ownerId))
      .first()
    return profile?.currency ?? DEFAULT_CURRENCY
  },
})

/**
 * Définit la devise de l'espace budget courant.
 * Réservé aux écritures (`requireWrite` bloque les lecteurs). Valide le code,
 * puis met à jour (ou crée) la ligne `userProfiles` du propriétaire effectif —
 * même logique create-or-update que `setAvatar` (cf. convex/users.ts).
 */
export const setCurrency = mutation({
  args: { currency: v.string() },
  handler: async (ctx, { currency }) => {
    const ownerId = await requireWrite(ctx)
    if (!ALLOWED_CURRENCIES.has(currency)) {
      throw new Error(`Devise non supportée : ${currency}`)
    }
    const profile = await ctx.db
      .query('userProfiles')
      .withIndex('by_user', (q) => q.eq('userId', ownerId))
      .first()
    if (profile) {
      await ctx.db.patch(profile._id, { currency })
    } else {
      await ctx.db.insert('userProfiles', { userId: ownerId, currency })
    }
  },
})
