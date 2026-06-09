import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { effectiveOwnerOrNull, requireWrite } from './sharing'
import { sectionExists } from './sections'

/**
 * Lignes récurrentes : modèles de lignes (loyer, abonnements, salaire…) que
 * l'utilisateur peut appliquer à n'importe quel mois en un clic.
 * Compatible BUDGET PARTAGÉ : `userId` ci-dessous = propriétaire effectif de
 * l'espace actif (écriture bloquée pour les lecteurs via `requireWrite`).
 */

// Clé de rubrique : clé libre (rubriques personnalisables) ; existence vérifiée
// dans les mutations.
const sectionValidator = v.string()

/** Propriétaire effectif pour une écriture (lève une erreur si lecteur). */
async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Id<'users'>> {
  return await requireWrite(ctx)
}

/** Liste les lignes récurrentes de l'utilisateur. */
export const listRecurring = query({
  args: {},
  handler: async (ctx) => {
    const userId = await effectiveOwnerOrNull(ctx)
    if (userId === null) return []
    return await ctx.db
      .query('recurringLines')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
  },
})

/** Crée une ligne récurrente. */
export const addRecurring = mutation({
  args: {
    section: sectionValidator,
    label: v.string(),
    amount: v.optional(v.number()),
  },
  handler: async (ctx, { section, label, amount }) => {
    const userId = await requireUser(ctx)
    if (!(await sectionExists(ctx, userId, section))) {
      throw new Error('Rubrique inconnue')
    }
    return await ctx.db.insert('recurringLines', {
      userId,
      section,
      label,
      amount: amount ?? 0,
    })
  },
})

/** Met à jour une ligne récurrente. */
export const updateRecurring = mutation({
  args: {
    id: v.id('recurringLines'),
    section: v.optional(sectionValidator),
    label: v.optional(v.string()),
    amount: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const userId = await requireUser(ctx)
    const doc = await ctx.db.get(id)
    if (!doc || doc.userId !== userId) throw new Error('Ligne récurrente introuvable')
    if (patch.section !== undefined && !(await sectionExists(ctx, userId, patch.section))) {
      throw new Error('Rubrique inconnue')
    }
    const fields = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    )
    await ctx.db.patch(id, fields)
  },
})

/** Supprime une ligne récurrente. */
export const removeRecurring = mutation({
  args: { id: v.id('recurringLines') },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx)
    const doc = await ctx.db.get(id)
    if (!doc || doc.userId !== userId) throw new Error('Ligne récurrente introuvable')
    await ctx.db.delete(id)
  },
})

/**
 * Applique les lignes récurrentes à un mois : crée dans ce mois chaque ligne
 * récurrente qui n'y figure pas déjà (même section + même libellé). Idempotent.
 * Renvoie le nombre de lignes ajoutées.
 */
export const applyRecurring = mutation({
  args: { monthId: v.id('months') },
  handler: async (ctx, { monthId }) => {
    const userId = await requireUser(ctx)
    const month = await ctx.db.get(monthId)
    if (!month || month.userId !== userId) throw new Error('Mois introuvable')

    const recurring = await ctx.db
      .query('recurringLines')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()

    // Lignes déjà présentes dans le mois (clé section|label, insensible à la casse).
    const existing = await ctx.db
      .query('entries')
      .withIndex('by_month', (q) => q.eq('monthId', monthId))
      .collect()
    const present = new Set(
      existing.map((e) => `${e.section}|${e.label.trim().toLowerCase()}`),
    )

    // Prochain `order` par section.
    const orderBySection = new Map<string, number>()
    for (const e of existing) {
      orderBySection.set(
        e.section,
        Math.max(orderBySection.get(e.section) ?? -1, e.order),
      )
    }

    let added = 0
    for (const r of recurring) {
      const key = `${r.section}|${r.label.trim().toLowerCase()}`
      if (present.has(key)) continue
      const next = (orderBySection.get(r.section) ?? -1) + 1
      orderBySection.set(r.section, next)
      await ctx.db.insert('entries', {
        userId,
        monthId,
        section: r.section,
        label: r.label,
        budget: r.amount,
        real: 0,
        order: next,
      })
      present.add(key)
      added++
    }
    return { added }
  },
})
