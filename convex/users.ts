import { v } from 'convex/values'
import {
  getAuthUserId,
  retrieveAccount,
  modifyAccountCredentials,
} from '@convex-dev/auth/server'
import { action, mutation, query } from './_generated/server'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

/**
 * Fonctions de COMPTE / PROFIL de l'utilisateur connecté.
 *
 * Contrairement aux fonctions de budget, elles ciblent TOUJOURS l'utilisateur
 * réellement connecté (`getAuthUserId`), jamais le « propriétaire effectif » du
 * budget partagé : un lecteur invité doit pouvoir gérer SON propre profil.
 *
 * Périmètre : pseudo (stocké dans `users.name`), avatar (table `userProfiles`
 * + file storage), et changement de mot de passe (provider Password).
 */

/** Récupère la ligne `userProfiles` de l'utilisateur (ou null). */
async function getProfile(ctx: QueryCtx | MutationCtx, userId: Id<'users'>) {
  return await ctx.db
    .query('userProfiles')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first()
}

/**
 * Informations du compte connecté pour l'en-tête et la page Profil.
 * Renvoie `{ userId, email, name, avatarUrl }`, ou `null` si non authentifié.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) return null
    const user = await ctx.db.get(userId)
    if (!user) return null
    const profile = await getProfile(ctx, userId)
    const avatarUrl = profile?.avatarId
      ? await ctx.storage.getUrl(profile.avatarId)
      : null
    return {
      userId,
      email: user.email ?? null,
      name: user.name ?? null,
      avatarUrl,
    }
  },
})

/** Met à jour le pseudo (nom affiché) dans `users.name`. */
export const updateProfile = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) throw new Error('Non authentifié')
    const trimmed = name.trim()
    // Vide ⇒ on retire le pseudo (retombe sur l'email pour l'affichage).
    await ctx.db.patch(userId, { name: trimmed || undefined })
  },
})

/**
 * URL d'upload pour l'avatar. Auth SEULE (pas de contrôle de rôle budget) : on
 * gère son propre avatar quel que soit le rôle sur l'espace budget regardé.
 */
export const generateAvatarUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) throw new Error('Non authentifié')
    return await ctx.storage.generateUploadUrl()
  },
})

/**
 * Définit (ou remplace) l'avatar de l'utilisateur. Si un avatar existait déjà,
 * son fichier est supprimé du storage (pas d'orphelins).
 */
export const setAvatar = mutation({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, { storageId }) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) throw new Error('Non authentifié')
    const profile = await getProfile(ctx, userId)
    if (profile) {
      if (profile.avatarId) await ctx.storage.delete(profile.avatarId)
      await ctx.db.patch(profile._id, { avatarId: storageId })
    } else {
      await ctx.db.insert('userProfiles', { userId, avatarId: storageId })
    }
  },
})

/** Retire l'avatar : supprime le fichier et vide le champ. */
export const removeAvatar = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) throw new Error('Non authentifié')
    const profile = await getProfile(ctx, userId)
    if (profile?.avatarId) {
      await ctx.storage.delete(profile.avatarId)
      await ctx.db.patch(profile._id, { avatarId: undefined })
    }
  },
})

/**
 * Change le mot de passe (provider Password).
 *
 * ACTION (et non mutation) car `retrieveAccount`/`modifyAccountCredentials`
 * exigent un contexte d'action. On vérifie d'abord l'ANCIEN mot de passe via
 * `retrieveAccount` (lève une erreur si incorrect), puis on pose le nouveau.
 * L'utilisateur reste connecté (on n'invalide pas les sessions).
 */
export const changePassword = action({
  args: { currentPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, { currentPassword, newPassword }) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) throw new Error('Non authentifié')
    if (newPassword.length < 8) {
      throw new Error('Le nouveau mot de passe doit faire au moins 8 caractères')
    }
    // L'email = identifiant du compte ; récupéré via la query `me` (pas de db en action).
    const user = await ctx.runQuery(api.users.me, {})
    if (!user?.email) throw new Error('Compte sans adresse email')

    // Vérifie l'ancien mot de passe (échoue si incorrect).
    try {
      await retrieveAccount(ctx, {
        provider: 'password',
        account: { id: user.email, secret: currentPassword },
      })
    } catch {
      throw new Error('Mot de passe actuel incorrect')
    }

    // Pose le nouveau mot de passe.
    await modifyAccountCredentials(ctx, {
      provider: 'password',
      account: { id: user.email, secret: newPassword },
    })
    return { ok: true }
  },
})

/**
 * SUPPRESSION DÉFINITIVE du compte et de TOUTES les données de l'utilisateur.
 *
 * Tout est effacé dans une seule mutation (transaction atomique) : données de
 * budget + fichiers stockés, données de partage, puis le compte d'auth lui-même
 * (comptes/sessions/refresh tokens + doc `users`) afin d'empêcher toute
 * reconnexion. Action IRRÉVERSIBLE (la confirmation se fait côté UI).
 *
 * Important pour le partage : on ne supprime QUE les liens de cet utilisateur ;
 * les budgets des autres propriétaires restent intacts. Les autres utilisateurs
 * qui regardaient l'espace de U sont simplement remis sur LEUR propre espace.
 */
export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) throw new Error('Non authentifié')

    // ── 1. Données de budget ────────────────────────────────────────────────
    // Mois + leurs lignes (les entries n'ont pas d'index par user : on passe
    // par leurs mois, qui couvrent l'intégralité des lignes de l'utilisateur).
    const months = await ctx.db
      .query('months')
      .withIndex('by_user_year_month', (q) => q.eq('userId', userId))
      .collect()
    for (const m of months) {
      const entries = await ctx.db
        .query('entries')
        .withIndex('by_month', (q) => q.eq('monthId', m._id))
        .collect()
      for (const e of entries) await ctx.db.delete(e._id)
      await ctx.db.delete(m._id)
    }

    // Reçus : suppression du fichier stocké puis du document.
    const receipts = await ctx.db
      .query('receipts')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    for (const r of receipts) {
      try {
        await ctx.storage.delete(r.storageId)
      } catch {
        /* fichier déjà absent : on ignore */
      }
      await ctx.db.delete(r._id)
    }

    // Avoir, historique, lignes récurrentes, objectifs d'épargne (index by_user).
    for (const table of [
      'assets',
      'assetHistory',
      'recurringLines',
      'savingsGoals',
    ] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect()
      for (const row of rows) await ctx.db.delete(row._id)
    }

    // Profil (avatar) : suppression du fichier puis du document.
    const profiles = await ctx.db
      .query('userProfiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    for (const p of profiles) {
      if (p.avatarId) {
        try {
          await ctx.storage.delete(p.avatarId)
        } catch {
          /* ignore */
        }
      }
      await ctx.db.delete(p._id)
    }

    // ── 2. Partage ──────────────────────────────────────────────────────────
    // Membres : U en tant que propriétaire (ses invités) ET en tant qu'invité.
    const asOwner = await ctx.db
      .query('budgetMembers')
      .withIndex('by_owner', (q) => q.eq('ownerId', userId))
      .collect()
    for (const m of asOwner) await ctx.db.delete(m._id)
    const asMember = await ctx.db
      .query('budgetMembers')
      .withIndex('by_member', (q) => q.eq('memberId', userId))
      .collect()
    for (const m of asMember) await ctx.db.delete(m._id)

    // Invitations émises par U.
    const invites = await ctx.db
      .query('budgetInvites')
      .withIndex('by_owner', (q) => q.eq('ownerId', userId))
      .collect()
    for (const i of invites) await ctx.db.delete(i._id)

    // Espaces actifs : on supprime celui de U, et on remet les AUTRES utilisateurs
    // qui regardaient l'espace de U sur leur propre espace (table minuscule : scan
    // complet, pas d'index par ownerId).
    const actives = await ctx.db.query('activeBudget').collect()
    for (const a of actives) {
      if (a.userId === userId) {
        await ctx.db.delete(a._id)
      } else if (a.ownerId === userId) {
        await ctx.db.patch(a._id, { ownerId: a.userId })
      }
    }

    // ── 3. Compte d'authentification (empêche la reconnexion) ────────────────
    const accounts = await ctx.db
      .query('authAccounts')
      .withIndex('userIdAndProvider', (q) => q.eq('userId', userId))
      .collect()
    for (const acc of accounts) await ctx.db.delete(acc._id)

    const sessions = await ctx.db
      .query('authSessions')
      .withIndex('userId', (q) => q.eq('userId', userId))
      .collect()
    for (const s of sessions) {
      const tokens = await ctx.db
        .query('authRefreshTokens')
        .withIndex('sessionId', (q) => q.eq('sessionId', s._id))
        .collect()
      for (const t of tokens) await ctx.db.delete(t._id)
      await ctx.db.delete(s._id)
    }

    // Enfin, le document utilisateur lui-même.
    await ctx.db.delete(userId)

    return { ok: true }
  },
})
