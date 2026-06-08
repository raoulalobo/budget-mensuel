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
