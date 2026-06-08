import { v } from 'convex/values'
import { getAuthUserId } from '@convex-dev/auth/server'
import { mutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

/**
 * BUDGET PARTAGÉ — résolution de l'« espace budget actif » et API de partage.
 *
 * Modèle (cf. schema.ts) : chaque utilisateur possède son espace (identifié par
 * son userId = `ownerId`). Il peut être invité dans l'espace d'un autre via un
 * CODE, avec un rôle (`editor` modifie / `viewer` consulte). À tout instant il
 * « regarde » un espace (le sien par défaut, ou un espace partagé) = l'espace
 * actif. Les fonctions de DONNÉES (budget.ts, goals.ts…) lisent/écrivent en
 * utilisant le `ownerId` de cet espace actif, et non le userId connecté.
 *
 * Ce fichier exporte les HELPERS réutilisés partout :
 *   - `effectiveOwnerOrNull` (queries : null si non connecté)
 *   - `requireRead`          (throw si non connecté ; renvoie owner + rôle)
 *   - `requireWrite`         (throw si non connecté OU lecteur ; renvoie owner)
 */

// Rôle effectif de l'utilisateur sur l'espace qu'il regarde.
export type EffectiveRole = 'owner' | 'editor' | 'viewer'

/**
 * Résout l'espace actif de l'utilisateur connecté ET son rôle.
 * Ne fait AUCUNE écriture (utilisable depuis une query) : si l'accès a été
 * révoqué entre-temps, on retombe simplement sur l'espace personnel.
 *
 * @returns null si non authentifié, sinon { self, ownerId, role }.
 *   - self    : userId réellement connecté
 *   - ownerId : propriétaire de l'espace regardé (= self si espace personnel)
 *   - role    : 'owner' | 'editor' | 'viewer'
 */
async function resolveActive(
  ctx: QueryCtx | MutationCtx,
): Promise<{ self: Id<'users'>; ownerId: Id<'users'>; role: EffectiveRole } | null> {
  const self = await getAuthUserId(ctx)
  if (self === null) return null

  // Espace actuellement sélectionné (`.first()` : tolère un éventuel doublon).
  const active = await ctx.db
    .query('activeBudget')
    .withIndex('by_user', (q) => q.eq('userId', self))
    .first()

  // Pas de sélection, ou sélection = soi-même ⇒ espace personnel (propriétaire).
  if (!active || active.ownerId === self) {
    return { self, ownerId: self, role: 'owner' }
  }

  // L'utilisateur regarde l'espace d'un autre : l'accès est-il toujours valide ?
  const membership = await ctx.db
    .query('budgetMembers')
    .withIndex('by_owner_member', (q) =>
      q.eq('ownerId', active.ownerId).eq('memberId', self),
    )
    .first()

  // Accès révoqué : repli sur l'espace personnel (sans écrire, on est en query).
  if (!membership) return { self, ownerId: self, role: 'owner' }

  return { self, ownerId: active.ownerId, role: membership.role }
}

/** Propriétaire effectif pour une QUERY de données (null si non connecté). */
export async function effectiveOwnerOrNull(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<'users'> | null> {
  const r = await resolveActive(ctx)
  return r ? r.ownerId : null
}

/** Propriétaire effectif + rôle ; lève une erreur si non authentifié. */
export async function requireRead(
  ctx: QueryCtx | MutationCtx,
): Promise<{ self: Id<'users'>; ownerId: Id<'users'>; role: EffectiveRole }> {
  const r = await resolveActive(ctx)
  if (!r) throw new Error('Non authentifié')
  return r
}

/**
 * Propriétaire effectif pour une ÉCRITURE de données.
 * Lève une erreur si non authentifié ou si l'utilisateur est en LECTURE SEULE.
 */
export async function requireWrite(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<'users'>> {
  const r = await resolveActive(ctx)
  if (!r) throw new Error('Non authentifié')
  if (r.role === 'viewer') {
    throw new Error('Lecture seule : vous n’avez pas le droit de modifier ce budget')
  }
  return r.ownerId
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers internes
// ───────────────────────────────────────────────────────────────────────────

/** Libellé lisible d'un utilisateur (pseudo, sinon email, sinon « Utilisateur »). */
async function userLabel(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
): Promise<string> {
  const u = await ctx.db.get(userId)
  // Le pseudo (users.name, défini depuis la page Profil) prime sur l'email.
  return u?.name ?? u?.email ?? 'Utilisateur'
}

// Alphabet sans caractères ambigus (pas de 0/O/1/I) pour les codes d'invitation.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Génère un code lisible du type « ABX7-K9P2 ». */
function makeCode(): string {
  let s = ''
  for (let i = 0; i < 8; i++) {
    if (i === 4) s += '-'
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return s
}

// ───────────────────────────────────────────────────────────────────────────
// QUERIES
// ───────────────────────────────────────────────────────────────────────────

/**
 * Espace budget actif courant : propriétaire, rôle, et droits d'écriture.
 * Sert au front pour afficher l'espace sélectionné et (dé)bloquer l'écriture.
 */
export const currentBudget = query({
  args: {},
  handler: async (ctx) => {
    const r = await resolveActive(ctx)
    if (!r) return null
    return {
      ownerId: r.ownerId,
      role: r.role,
      isOwner: r.role === 'owner',
      canEdit: r.role === 'owner' || r.role === 'editor',
      ownerLabel: await userLabel(ctx, r.ownerId),
    }
  },
})

/**
 * Liste des espaces accessibles par l'utilisateur (pour le sélecteur d'espace) :
 * son espace personnel + chaque espace où il a été invité.
 */
export const myBudgets = query({
  args: {},
  handler: async (ctx) => {
    const self = await getAuthUserId(ctx)
    if (self === null) return []
    const active = await ctx.db
      .query('activeBudget')
      .withIndex('by_user', (q) => q.eq('userId', self))
      .first()
    const activeOwner = active?.ownerId ?? self

    // Espace personnel (toujours présent, rôle propriétaire).
    const list: Array<{
      ownerId: Id<'users'>
      label: string
      role: EffectiveRole
      isActive: boolean
    }> = [
      {
        ownerId: self,
        label: 'Mon budget',
        role: 'owner',
        isActive: activeOwner === self,
      },
    ]

    // Espaces partagés où je suis membre.
    const memberships = await ctx.db
      .query('budgetMembers')
      .withIndex('by_member', (q) => q.eq('memberId', self))
      .collect()
    for (const m of memberships) {
      list.push({
        ownerId: m.ownerId,
        label: await userLabel(ctx, m.ownerId),
        role: m.role,
        isActive: activeOwner === m.ownerId,
      })
    }
    return list
  },
})

/**
 * Membres de l'espace ACTIF (propriétaire inclus) + codes d'invitation en
 * attente (visibles uniquement par le propriétaire). Sert à la page « Partage ».
 */
export const budgetTeam = query({
  args: {},
  handler: async (ctx) => {
    const r = await resolveActive(ctx)
    if (!r) return null

    // Propriétaire (en tête), puis les membres.
    const members: Array<{
      userId: Id<'users'>
      label: string
      role: EffectiveRole
      isSelf: boolean
    }> = [
      {
        userId: r.ownerId,
        label: await userLabel(ctx, r.ownerId),
        role: 'owner',
        isSelf: r.ownerId === r.self,
      },
    ]
    const rows = await ctx.db
      .query('budgetMembers')
      .withIndex('by_owner', (q) => q.eq('ownerId', r.ownerId))
      .collect()
    for (const m of rows) {
      members.push({
        userId: m.memberId,
        label: await userLabel(ctx, m.memberId),
        role: m.role,
        isSelf: m.memberId === r.self,
      })
    }

    // Invitations en attente : seul le propriétaire les voit.
    const invites =
      r.role === 'owner'
        ? (
            await ctx.db
              .query('budgetInvites')
              .withIndex('by_owner', (q) => q.eq('ownerId', r.ownerId))
              .collect()
          ).map((i) => ({ inviteId: i._id, code: i.code, role: i.role }))
        : []

    return {
      ownerId: r.ownerId,
      myRole: r.role,
      isOwner: r.role === 'owner',
      members,
      invites,
    }
  },
})

// ───────────────────────────────────────────────────────────────────────────
// MUTATIONS — gestion des invitations et des membres
// ───────────────────────────────────────────────────────────────────────────

const roleValidator = v.union(v.literal('editor'), v.literal('viewer'))

/**
 * Le propriétaire de l'espace ACTIF génère un code d'invitation pour le rôle
 * donné. Seul un propriétaire peut inviter (on invite TOUJOURS sur son propre
 * espace : on force l'espace personnel pour éviter les invitations croisées).
 */
export const createInvite = mutation({
  args: { role: roleValidator },
  handler: async (ctx, { role }) => {
    const self = await getAuthUserId(ctx)
    if (self === null) throw new Error('Non authentifié')

    // Génère un code unique (réessaie en cas de collision improbable).
    let code = makeCode()
    for (let i = 0; i < 5; i++) {
      const exists = await ctx.db
        .query('budgetInvites')
        .withIndex('by_code', (q) => q.eq('code', code))
        .first()
      if (!exists) break
      code = makeCode()
    }

    await ctx.db.insert('budgetInvites', { ownerId: self, code, role })
    return { code, role }
  },
})

/** Le propriétaire révoque (supprime) un code d'invitation en attente. */
export const revokeInvite = mutation({
  args: { inviteId: v.id('budgetInvites') },
  handler: async (ctx, { inviteId }) => {
    const self = await getAuthUserId(ctx)
    if (self === null) throw new Error('Non authentifié')
    const inv = await ctx.db.get(inviteId)
    if (!inv || inv.ownerId !== self) throw new Error('Invitation introuvable')
    await ctx.db.delete(inviteId)
  },
})

/**
 * L'utilisateur connecté rejoint un espace via un CODE.
 * Validations : code valide, pas son propre espace, pas déjà membre.
 * Effets : crée l'appartenance, consomme le code (usage unique), et bascule
 * automatiquement l'espace actif vers le budget rejoint.
 */
export const redeemInvite = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const self = await getAuthUserId(ctx)
    if (self === null) throw new Error('Non authentifié')

    const clean = code.trim().toUpperCase()
    const inv = await ctx.db
      .query('budgetInvites')
      .withIndex('by_code', (q) => q.eq('code', clean))
      .first()
    if (!inv) throw new Error('Code invalide ou expiré')
    if (inv.ownerId === self) throw new Error('C’est déjà votre budget')

    // Déjà membre ? On met simplement le rôle à jour et on consomme le code.
    const existing = await ctx.db
      .query('budgetMembers')
      .withIndex('by_owner_member', (q) =>
        q.eq('ownerId', inv.ownerId).eq('memberId', self),
      )
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, { role: inv.role })
    } else {
      await ctx.db.insert('budgetMembers', {
        ownerId: inv.ownerId,
        memberId: self,
        role: inv.role,
      })
    }

    await ctx.db.delete(inv._id) // code à usage unique
    await setActive(ctx, self, inv.ownerId) // bascule sur le budget rejoint
    return { ownerLabel: await userLabel(ctx, inv.ownerId), role: inv.role }
  },
})

/** Upsert de l'espace actif d'un utilisateur (une seule ligne par user). */
async function setActive(
  ctx: MutationCtx,
  userId: Id<'users'>,
  ownerId: Id<'users'>,
) {
  const rows = await ctx.db
    .query('activeBudget')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect()
  if (rows.length === 0) {
    await ctx.db.insert('activeBudget', { userId, ownerId })
  } else {
    await ctx.db.patch(rows[0]._id, { ownerId })
    // Nettoie d'éventuels doublons hérités.
    for (let i = 1; i < rows.length; i++) await ctx.db.delete(rows[i]._id)
  }
}

/**
 * Bascule l'espace budget actif. L'utilisateur ne peut basculer que vers son
 * propre espace ou un espace dont il est membre (vérification d'accès).
 */
export const switchBudget = mutation({
  args: { ownerId: v.id('users') },
  handler: async (ctx, { ownerId }) => {
    const self = await getAuthUserId(ctx)
    if (self === null) throw new Error('Non authentifié')

    if (ownerId !== self) {
      const membership = await ctx.db
        .query('budgetMembers')
        .withIndex('by_owner_member', (q) =>
          q.eq('ownerId', ownerId).eq('memberId', self),
        )
        .first()
      if (!membership) throw new Error('Accès non autorisé à cet espace')
    }
    await setActive(ctx, self, ownerId)
  },
})

/** Le propriétaire change le rôle d'un membre de son espace. */
export const setMemberRole = mutation({
  args: { memberId: v.id('users'), role: roleValidator },
  handler: async (ctx, { memberId, role }) => {
    const self = await getAuthUserId(ctx)
    if (self === null) throw new Error('Non authentifié')
    const m = await ctx.db
      .query('budgetMembers')
      .withIndex('by_owner_member', (q) =>
        q.eq('ownerId', self).eq('memberId', memberId),
      )
      .first()
    if (!m) throw new Error('Membre introuvable')
    await ctx.db.patch(m._id, { role })
  },
})

/**
 * Le propriétaire retire un membre de son espace. Si ce membre regardait cet
 * espace, sa prochaine résolution retombera automatiquement sur le sien ; on
 * remet aussi son espace actif à lui-même par propreté.
 */
export const removeMember = mutation({
  args: { memberId: v.id('users') },
  handler: async (ctx, { memberId }) => {
    const self = await getAuthUserId(ctx)
    if (self === null) throw new Error('Non authentifié')
    const m = await ctx.db
      .query('budgetMembers')
      .withIndex('by_owner_member', (q) =>
        q.eq('ownerId', self).eq('memberId', memberId),
      )
      .first()
    if (!m) throw new Error('Membre introuvable')
    await ctx.db.delete(m._id)
    await resetActiveIfPointingTo(ctx, memberId, self)
  },
})

/**
 * Un membre quitte de lui-même un espace partagé.
 */
export const leaveBudget = mutation({
  args: { ownerId: v.id('users') },
  handler: async (ctx, { ownerId }) => {
    const self = await getAuthUserId(ctx)
    if (self === null) throw new Error('Non authentifié')
    const m = await ctx.db
      .query('budgetMembers')
      .withIndex('by_owner_member', (q) =>
        q.eq('ownerId', ownerId).eq('memberId', self),
      )
      .first()
    if (m) await ctx.db.delete(m._id)
    await resetActiveIfPointingTo(ctx, self, ownerId)
  },
})

/** Si l'espace actif de `userId` pointe vers `ownerId`, le remet sur lui-même. */
async function resetActiveIfPointingTo(
  ctx: MutationCtx,
  userId: Id<'users'>,
  ownerId: Id<'users'>,
) {
  const active = await ctx.db
    .query('activeBudget')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first()
  if (active && active.ownerId === ownerId) {
    await ctx.db.patch(active._id, { ownerId: userId })
  }
}
