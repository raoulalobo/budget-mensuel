import { v } from 'convex/values'
import { getAuthUserId } from '@convex-dev/auth/server'
import { mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'

/**
 * Fonctions backend des "Objectifs d'épargne".
 *
 * Un objectif = { label, target (montant visé), current (déjà épargné) }.
 * Comme partout, chaque fonction est limitée aux données de l'utilisateur connecté.
 */

/** Récupère l'utilisateur connecté ou lève une erreur. */
async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Id<'users'>> {
  const userId = await getAuthUserId(ctx)
  if (userId === null) throw new Error('Non authentifié')
  return userId
}

/** Liste les objectifs d'épargne de l'utilisateur, dans l'ordre. */
export const listGoals = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) return []
    const goals = await ctx.db
      .query('savingsGoals')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    goals.sort((a, b) => a.order - b.order)
    return goals
  },
})

/** Crée un objectif d'épargne. */
export const addGoal = mutation({
  args: {
    label: v.string(),
    target: v.optional(v.number()),
    current: v.optional(v.number()),
  },
  handler: async (ctx, { label, target, current }) => {
    const userId = await requireUser(ctx)
    const existing = await ctx.db
      .query('savingsGoals')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    const nextOrder =
      existing.reduce((max, g) => Math.max(max, g.order), -1) + 1
    return await ctx.db.insert('savingsGoals', {
      userId,
      label,
      target: target ?? 0,
      current: current ?? 0,
      order: nextOrder,
    })
  },
})

/** Met à jour un objectif (libellé, cible et/ou montant épargné). */
export const updateGoal = mutation({
  args: {
    goalId: v.id('savingsGoals'),
    label: v.optional(v.string()),
    target: v.optional(v.number()),
    current: v.optional(v.number()),
  },
  handler: async (ctx, { goalId, ...patch }) => {
    const userId = await requireUser(ctx)
    const goal = await ctx.db.get(goalId)
    if (!goal || goal.userId !== userId) throw new Error('Objectif introuvable')
    const fields = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    )
    await ctx.db.patch(goalId, fields)
  },
})

/** Supprime un objectif d'épargne. */
export const removeGoal = mutation({
  args: { goalId: v.id('savingsGoals') },
  handler: async (ctx, { goalId }) => {
    const userId = await requireUser(ctx)
    const goal = await ctx.db.get(goalId)
    if (!goal || goal.userId !== userId) throw new Error('Objectif introuvable')
    await ctx.db.delete(goalId)
  },
})
