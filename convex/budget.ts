import { v } from 'convex/values'
import { getAuthUserId } from '@convex-dev/auth/server'
import { mutation, query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

/**
 * Fonctions backend de l'application Budget.
 *
 * Toutes les fonctions sont "multi-utilisateurs" : elles récupèrent l'identité
 * via Convex Auth (`getAuthUserId`) et ne renvoient/modifient QUE les données
 * appartenant à l'utilisateur connecté. Une tentative d'accès à la donnée d'un
 * autre utilisateur lève une erreur.
 */

// Validateur réutilisable pour la section d'une ligne de budget.
const sectionValidator = v.union(
  v.literal('income'),
  v.literal('fixed'),
  v.literal('variable'),
  v.literal('credit'),
  v.literal('saving'),
)

/** Récupère l'id de l'utilisateur connecté ou lève une erreur d'authentification. */
async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Id<'users'>> {
  const userId = await getAuthUserId(ctx)
  if (userId === null) {
    throw new Error('Non authentifié')
  }
  return userId
}

/**
 * Calcule le résumé (Revenus / Dépenses / NET, en prévu et réel) d'un jeu de
 * lignes. Dupliqué côté serveur pour pouvoir agréger sans dépendre du front.
 */
function summarize(entries: Array<Doc<'entries'>>) {
  let incomeBudget = 0,
    incomeReal = 0,
    expenseBudget = 0,
    expenseReal = 0
  for (const e of entries) {
    if (e.section === 'income') {
      incomeBudget += e.budget
      incomeReal += e.real
    } else {
      expenseBudget += e.budget
      expenseReal += e.real
    }
  }
  return {
    incomeBudget,
    incomeReal,
    expenseBudget,
    expenseReal,
    netBudget: incomeBudget - expenseBudget,
    netReal: incomeReal - expenseReal,
  }
}

/** Vérifie qu'un mois appartient bien à l'utilisateur, sinon lève une erreur. */
async function getOwnedMonth(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
  monthId: Id<'months'>,
) {
  const month = await ctx.db.get(monthId)
  if (!month || month.userId !== userId) {
    throw new Error('Mois introuvable')
  }
  return month
}

/** Vérifie qu'une ligne appartient bien à l'utilisateur, sinon lève une erreur. */
async function getOwnedEntry(
  ctx: MutationCtx,
  userId: Id<'users'>,
  entryId: Id<'entries'>,
) {
  const entry = await ctx.db.get(entryId)
  if (!entry || entry.userId !== userId) {
    throw new Error('Ligne introuvable')
  }
  return entry
}

// ───────────────────────────────────────────────────────────────────────────
// MOIS
// ───────────────────────────────────────────────────────────────────────────

/**
 * Liste tous les mois de l'utilisateur (toutes années) avec, pour chacun, son
 * résumé chiffré. Trié du plus récent au plus ancien.
 * Utilisé par la liste latérale et le tableau de bord.
 */
export const listMonths = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) return []

    const months = await ctx.db
      .query('months')
      .withIndex('by_user_year_month', (q) => q.eq('userId', userId))
      .collect()

    const withSummary = await Promise.all(
      months.map(async (m) => {
        const entries = await ctx.db
          .query('entries')
          .withIndex('by_month', (q) => q.eq('monthId', m._id))
          .collect()
        return { ...m, summary: summarize(entries) }
      }),
    )

    // Tri décroissant : année puis mois.
    withSummary.sort((a, b) => b.year - a.year || b.month - a.month)
    return withSummary
  },
})

/**
 * Renvoie les données complètes d'un mois donné (année + numéro de mois) :
 * le document mois, ses lignes triées et son résumé.
 * Renvoie `null` si le mois n'a pas encore été créé.
 */
export const getMonth = query({
  args: { year: v.number(), month: v.number() },
  handler: async (ctx, { year, month }) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) return null

    const monthDoc = await ctx.db
      .query('months')
      .withIndex('by_user_year_month', (q) =>
        q.eq('userId', userId).eq('year', year).eq('month', month),
      )
      .unique()
    if (!monthDoc) return null

    const entries = await ctx.db
      .query('entries')
      .withIndex('by_month', (q) => q.eq('monthId', monthDoc._id))
      .collect()
    entries.sort((a, b) => a.order - b.order)

    return { month: monthDoc, entries, summary: summarize(entries) }
  },
})

/**
 * Crée le mois (année, numéro) s'il n'existe pas encore et renvoie son id.
 * Idempotent : appelé avant d'ajouter une ligne dans un mois "vide".
 */
export const ensureMonth = mutation({
  args: { year: v.number(), month: v.number() },
  handler: async (ctx, { year, month }) => {
    const userId = await requireUser(ctx)
    const existing = await ctx.db
      .query('months')
      .withIndex('by_user_year_month', (q) =>
        q.eq('userId', userId).eq('year', year).eq('month', month),
      )
      .unique()
    if (existing) return existing._id
    return await ctx.db.insert('months', { userId, year, month })
  },
})

// ───────────────────────────────────────────────────────────────────────────
// LIGNES (entries)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Ajoute une ligne de budget dans un mois.
 * `order` est calculé automatiquement (fin de la section concernée).
 */
export const addEntry = mutation({
  args: {
    monthId: v.id('months'),
    section: sectionValidator,
    label: v.string(),
    budget: v.optional(v.number()),
    real: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx)
    await getOwnedMonth(ctx, userId, args.monthId)

    // Place la nouvelle ligne après la dernière de sa section.
    const sameSection = await ctx.db
      .query('entries')
      .withIndex('by_month_section', (q) =>
        q.eq('monthId', args.monthId).eq('section', args.section),
      )
      .collect()
    const nextOrder =
      sameSection.reduce((max, e) => Math.max(max, e.order), -1) + 1

    return await ctx.db.insert('entries', {
      userId,
      monthId: args.monthId,
      section: args.section,
      label: args.label,
      budget: args.budget ?? 0,
      real: args.real ?? 0,
      order: nextOrder,
    })
  },
})

/**
 * Met à jour un ou plusieurs champs d'une ligne (libellé, budget, réel).
 * Seuls les champs fournis sont modifiés.
 */
export const updateEntry = mutation({
  args: {
    entryId: v.id('entries'),
    label: v.optional(v.string()),
    budget: v.optional(v.number()),
    real: v.optional(v.number()),
  },
  handler: async (ctx, { entryId, ...patch }) => {
    const userId = await requireUser(ctx)
    await getOwnedEntry(ctx, userId, entryId)
    // On ne garde que les champs réellement définis.
    const fields = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    )
    await ctx.db.patch(entryId, fields)
  },
})

/** Supprime une ligne de budget. */
export const removeEntry = mutation({
  args: { entryId: v.id('entries') },
  handler: async (ctx, { entryId }) => {
    const userId = await requireUser(ctx)
    await getOwnedEntry(ctx, userId, entryId)
    await ctx.db.delete(entryId)
  },
})

/**
 * Import en masse de lignes dans un mois (utilisé par l'import CSV).
 *
 * @param replace  si `true`, on supprime d'abord toutes les lignes existantes
 *                 du mois avant d'insérer les nouvelles.
 * Les `order` sont (re)calculés par section pour rester cohérents.
 * Renvoie le nombre de lignes importées.
 */
export const importEntries = mutation({
  args: {
    monthId: v.id('months'),
    replace: v.optional(v.boolean()),
    entries: v.array(
      v.object({
        section: sectionValidator,
        label: v.string(),
        budget: v.number(),
        real: v.number(),
      }),
    ),
  },
  handler: async (ctx, { monthId, entries, replace }) => {
    const userId = await requireUser(ctx)
    await getOwnedMonth(ctx, userId, monthId)

    // Remplacement éventuel : on vide le mois d'abord.
    if (replace) {
      const old = await ctx.db
        .query('entries')
        .withIndex('by_month', (q) => q.eq('monthId', monthId))
        .collect()
      await Promise.all(old.map((e) => ctx.db.delete(e._id)))
    }

    // Compteur d'ordre par section (reprend après l'existant si on n'a pas remplacé).
    const orderBySection = new Map<string, number>()
    if (!replace) {
      const current = await ctx.db
        .query('entries')
        .withIndex('by_month', (q) => q.eq('monthId', monthId))
        .collect()
      for (const e of current) {
        orderBySection.set(
          e.section,
          Math.max(orderBySection.get(e.section) ?? -1, e.order),
        )
      }
    }

    for (const e of entries) {
      const next = (orderBySection.get(e.section) ?? -1) + 1
      orderBySection.set(e.section, next)
      await ctx.db.insert('entries', {
        userId,
        monthId,
        section: e.section,
        label: e.label,
        budget: e.budget,
        real: e.real,
        order: next,
      })
    }

    return { imported: entries.length }
  },
})

/**
 * Duplique toutes les lignes d'un mois source vers un mois cible.
 *
 * Cas d'usage : reporter les charges récurrentes d'un mois sur le suivant.
 * - Le mois cible est créé s'il n'existe pas.
 * - Si le mois cible contient déjà des lignes, on ne fait rien (pas d'écrasement).
 * - `resetReal` (défaut `true`) : remet le montant "réel" à 0 dans la copie
 *   (on ne connaît pas encore les dépenses réelles du mois suivant).
 */
export const duplicateMonth = mutation({
  args: {
    sourceMonthId: v.id('months'),
    targetYear: v.number(),
    targetMonth: v.number(),
    resetReal: v.optional(v.boolean()),
  },
  handler: async (ctx, { sourceMonthId, targetYear, targetMonth, resetReal }) => {
    const userId = await requireUser(ctx)
    await getOwnedMonth(ctx, userId, sourceMonthId)

    // Crée (ou retrouve) le mois cible.
    let target = await ctx.db
      .query('months')
      .withIndex('by_user_year_month', (q) =>
        q.eq('userId', userId).eq('year', targetYear).eq('month', targetMonth),
      )
      .unique()
    let targetId: Id<'months'>
    if (target) {
      // Refuse si le mois cible n'est pas vide (évite les doublons).
      const existing = await ctx.db
        .query('entries')
        .withIndex('by_month', (q) => q.eq('monthId', target!._id))
        .first()
      if (existing) {
        return { duplicated: false, reason: 'Le mois cible contient déjà des données' }
      }
      targetId = target._id
    } else {
      targetId = await ctx.db.insert('months', {
        userId,
        year: targetYear,
        month: targetMonth,
      })
    }

    // Copie les lignes du mois source.
    const source = await ctx.db
      .query('entries')
      .withIndex('by_month', (q) => q.eq('monthId', sourceMonthId))
      .collect()
    const reset = resetReal ?? true
    for (const e of source) {
      await ctx.db.insert('entries', {
        userId,
        monthId: targetId,
        section: e.section,
        label: e.label,
        budget: e.budget,
        real: reset ? 0 : e.real,
        order: e.order,
      })
    }

    return { duplicated: true, count: source.length }
  },
})

// ───────────────────────────────────────────────────────────────────────────
// AVOIR (assets)
// ───────────────────────────────────────────────────────────────────────────

/** Liste les placements/patrimoine de l'utilisateur (onglet "Avoir"). */
export const listAssets = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) return []
    const assets = await ctx.db
      .query('assets')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    assets.sort((a, b) => a.order - b.order)
    return assets
  },
})

/** Ajoute un placement. */
export const addAsset = mutation({
  args: { label: v.string(), amount: v.optional(v.number()) },
  handler: async (ctx, { label, amount }) => {
    const userId = await requireUser(ctx)
    const existing = await ctx.db
      .query('assets')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    const nextOrder =
      existing.reduce((max, a) => Math.max(max, a.order), -1) + 1
    return await ctx.db.insert('assets', {
      userId,
      label,
      amount: amount ?? 0,
      order: nextOrder,
    })
  },
})

/** Met à jour un placement (libellé et/ou montant). */
export const updateAsset = mutation({
  args: {
    assetId: v.id('assets'),
    label: v.optional(v.string()),
    amount: v.optional(v.number()),
  },
  handler: async (ctx, { assetId, ...patch }) => {
    const userId = await requireUser(ctx)
    const asset = await ctx.db.get(assetId)
    if (!asset || asset.userId !== userId) throw new Error('Placement introuvable')
    const fields = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    )
    await ctx.db.patch(assetId, fields)
  },
})

/** Supprime un placement. */
export const removeAsset = mutation({
  args: { assetId: v.id('assets') },
  handler: async (ctx, { assetId }) => {
    const userId = await requireUser(ctx)
    const asset = await ctx.db.get(assetId)
    if (!asset || asset.userId !== userId) throw new Error('Placement introuvable')
    await ctx.db.delete(assetId)
  },
})
