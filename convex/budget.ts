import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { effectiveOwnerOrNull, requireWrite } from './sharing'
import { incomeKeysFor, loadSections, sectionExists } from './sections'

/**
 * Fonctions backend de l'application Budget.
 *
 * Toutes les fonctions sont "multi-utilisateurs" ET compatibles BUDGET PARTAGÉ :
 * au lieu de l'utilisateur connecté, elles ciblent le PROPRIÉTAIRE EFFECTIF de
 * l'espace budget regardé (cf. convex/sharing.ts) :
 *   - lecture  → `effectiveOwnerOrNull` (l'espace actif, ou null si déconnecté)
 *   - écriture → `requireWrite` (l'espace actif ; lève une erreur si lecteur)
 * Dans tout ce fichier, la variable `userId` désigne donc cet « owner effectif »
 * (= l'utilisateur connecté lorsqu'il regarde son propre budget).
 */

// Validateur de la clé de rubrique : clé libre (rubriques personnalisables).
// L'existence de la clé pour le propriétaire est vérifiée dans les mutations.
const sectionValidator = v.string()

/**
 * Récupère le propriétaire effectif pour une ÉCRITURE : l'espace budget actif.
 * Lève une erreur si non authentifié ou si l'utilisateur est en lecture seule.
 * (Conserve le nom `requireUser` : tous les call sites d'écriture l'utilisent.)
 */
async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Id<'users'>> {
  return await requireWrite(ctx)
}

/**
 * Calcule le résumé (Revenus / Dépenses / NET, en prévu et réel) d'un jeu de
 * lignes. Dupliqué côté serveur pour pouvoir agréger sans dépendre du front.
 */
function summarize(
  entries: Array<Doc<'entries'>>,
  incomeKeys: Set<string>,
) {
  let incomeBudget = 0,
    incomeReal = 0,
    expenseBudget = 0,
    expenseReal = 0
  for (const e of entries) {
    if (incomeKeys.has(e.section)) {
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
  ctx: QueryCtx | MutationCtx,
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
    const userId = await effectiveOwnerOrNull(ctx)
    if (userId === null) return []

    const months = await ctx.db
      .query('months')
      .withIndex('by_user_year_month', (q) => q.eq('userId', userId))
      .collect()

    // Clés « Revenu » du propriétaire (chargées une fois) pour le calcul du Net.
    const income = await incomeKeysFor(ctx, userId)

    const withSummary = await Promise.all(
      months.map(async (m) => {
        const entries = await ctx.db
          .query('entries')
          .withIndex('by_month', (q) => q.eq('monthId', m._id))
          .collect()
        return { ...m, summary: summarize(entries, income) }
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
    const userId = await effectiveOwnerOrNull(ctx)
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

    // Rubriques du propriétaire (libellés/couleurs/kind/ordre) + clés Revenu.
    const sections = await loadSections(ctx, userId)
    const income = new Set(
      sections.filter((s) => s.kind === 'income').map((s) => s.key),
    )
    // Repli si pas encore seedé : 'income' compte comme revenu.
    if (sections.length === 0) income.add('income')

    return {
      month: monthDoc,
      entries,
      summary: summarize(entries, income),
      sections,
    }
  },
})

/**
 * Instantané complet des données de l'utilisateur, destiné à l'assistant IA :
 * tous les mois (avec lignes + résumé), le patrimoine, les objectifs d'épargne
 * et les lignes récurrentes. Renvoie `null` si non authentifié.
 */
export const assistantSnapshot = query({
  args: {},
  handler: async (ctx) => {
    const userId = await effectiveOwnerOrNull(ctx)
    if (userId === null) return null

    const months = await ctx.db
      .query('months')
      .withIndex('by_user_year_month', (q) => q.eq('userId', userId))
      .collect()
    months.sort((a, b) => a.year - b.year || a.month - b.month)

    // Rubriques : pour le Net (clés Revenu) et les libellés transmis à l'IA.
    const sectionDocs = await loadSections(ctx, userId)
    const income = new Set(
      sectionDocs.filter((s) => s.kind === 'income').map((s) => s.key),
    )
    if (sectionDocs.length === 0) income.add('income')
    const sectionLabels: Record<string, string> = {}
    for (const s of sectionDocs) sectionLabels[s.key] = s.label

    const monthData = []
    for (const m of months) {
      const entries = await ctx.db
        .query('entries')
        .withIndex('by_month', (q) => q.eq('monthId', m._id))
        .collect()
      // On n'inclut que les mois contenant au moins une ligne.
      if (entries.length === 0) continue
      monthData.push({
        year: m.year,
        month: m.month,
        summary: summarize(entries, income),
        entries: entries.map((e) => ({
          section: e.section,
          label: e.label,
          budget: e.budget,
          real: e.real,
        })),
      })
    }

    const recurring = await ctx.db
      .query('recurringLines')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()

    return {
      months: monthData,
      sectionLabels,
      recurring: recurring.map((r) => ({
        section: r.section,
        label: r.label,
        amount: r.amount,
      })),
    }
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
    note: v.optional(v.string()),
    receiptId: v.optional(v.id('receipts')),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx)
    await getOwnedMonth(ctx, userId, args.monthId)
    if (!(await sectionExists(ctx, userId, args.section))) {
      throw new Error('Rubrique inconnue')
    }

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
      note: args.note,
      receiptId: args.receiptId,
      tags: args.tags,
    })
  },
})

/**
 * Supprime un reçu (fichier + doc) UNIQUEMENT s'il n'est plus référencé par
 * aucune ligne (comptage de références). Évite d'effacer une photo encore
 * utilisée par d'autres lignes du même ticket, et évite les orphelins.
 */
async function maybeDeleteReceipt(
  ctx: MutationCtx,
  userId: Id<'users'>,
  receiptId: Id<'receipts'>,
) {
  const stillUsed = await ctx.db
    .query('entries')
    .withIndex('by_receipt', (q) => q.eq('receiptId', receiptId))
    .first()
  if (stillUsed) return
  const receipt = await ctx.db.get(receiptId)
  if (!receipt || receipt.userId !== userId) return
  await ctx.storage.delete(receipt.storageId)
  await ctx.db.delete(receiptId)
}

/**
 * Met à jour un ou plusieurs champs d'une ligne (libellé, budget, réel, note,
 * reçu/photo). Seuls les champs fournis sont modifiés.
 *
 * Au remplacement du reçu (`receiptId`), l'ancien reçu est nettoyé s'il n'est
 * plus référencé par aucune autre ligne.
 */
export const updateEntry = mutation({
  args: {
    entryId: v.id('entries'),
    label: v.optional(v.string()),
    budget: v.optional(v.number()),
    real: v.optional(v.number()),
    note: v.optional(v.string()),
    receiptId: v.optional(v.id('receipts')),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { entryId, ...patch }) => {
    const userId = await requireUser(ctx)
    const entry = await getOwnedEntry(ctx, userId, entryId)
    const oldReceiptId = entry.receiptId

    // On ne garde que les champs réellement définis.
    const fields = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    )
    await ctx.db.patch(entryId, fields)

    // Remplacement de reçu : nettoyer l'ancien s'il n'est plus utilisé.
    if (
      patch.receiptId !== undefined &&
      oldReceiptId &&
      oldReceiptId !== patch.receiptId
    ) {
      await maybeDeleteReceipt(ctx, userId, oldReceiptId)
    }
  },
})

/**
 * Supprime une ligne de budget. Son reçu n'est effacé que s'il n'est plus
 * référencé par une autre ligne (comptage de références).
 */
export const removeEntry = mutation({
  args: { entryId: v.id('entries') },
  handler: async (ctx, { entryId }) => {
    const userId = await requireUser(ctx)
    const entry = await getOwnedEntry(ctx, userId, entryId)
    const receiptId = entry.receiptId
    await ctx.db.delete(entryId)
    if (receiptId) {
      await maybeDeleteReceipt(ctx, userId, receiptId)
    }
  },
})

/**
 * Vide une rubrique dans UN mois : supprime toutes les lignes de la section
 * donnée pour ce mois uniquement (les autres mois ne sont pas affectés).
 *
 * Les reçus des lignes supprimées sont nettoyés via `maybeDeleteReceipt`
 * (comptage de références : un reçu encore partagé par une ligne d'un autre
 * mois est conservé). Renvoie le nombre de lignes supprimées.
 */
export const clearSectionEntries = mutation({
  args: {
    monthId: v.id('months'),
    section: sectionValidator,
  },
  handler: async (ctx, { monthId, section }) => {
    const userId = await requireUser(ctx)
    await getOwnedMonth(ctx, userId, monthId)

    // Lignes de cette rubrique dans ce mois (index dédié).
    const entries = await ctx.db
      .query('entries')
      .withIndex('by_month_section', (q) =>
        q.eq('monthId', monthId).eq('section', section),
      )
      .collect()

    // Supprime les lignes en mémorisant les reçus rencontrés (dédupliqués).
    const receiptIds = new Set<Id<'receipts'>>()
    for (const e of entries) {
      if (e.receiptId) receiptIds.add(e.receiptId)
      await ctx.db.delete(e._id)
    }
    // Nettoyage des reçus APRÈS suppression des lignes : le comptage de
    // références de `maybeDeleteReceipt` ne voit plus les lignes supprimées.
    for (const receiptId of receiptIds) {
      await maybeDeleteReceipt(ctx, userId, receiptId)
    }

    return { removed: entries.length }
  },
})

/**
 * Génère une URL d'upload signée (file storage Convex). Le client y envoie le
 * fichier (POST) et reçoit un `storageId`, qu'il transforme ensuite en reçu via
 * `createReceipt`.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    return await ctx.storage.generateUploadUrl()
  },
})

/**
 * Crée un reçu à partir d'un fichier déjà uploadé (son `storageId`) et renvoie
 * son `receiptId`, à rattacher à une ou plusieurs lignes.
 */
export const createReceipt = mutation({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, { storageId }) => {
    const userId = await requireUser(ctx)
    return await ctx.db.insert('receipts', { userId, storageId })
  },
})

/**
 * Renvoie l'URL (signée, temporaire) du reçu/photo d'une ligne, ou `null` si la
 * ligne n'a pas de reçu.
 */
export const entryPhotoUrl = query({
  args: { entryId: v.id('entries') },
  handler: async (ctx, { entryId }) => {
    const userId = await effectiveOwnerOrNull(ctx)
    if (userId === null) return null
    const entry = await ctx.db.get(entryId)
    if (!entry || entry.userId !== userId || !entry.receiptId) return null
    const receipt = await ctx.db.get(entry.receiptId)
    if (!receipt || receipt.userId !== userId) return null
    return await ctx.storage.getUrl(receipt.storageId)
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
        // Reçu optionnel (partagé entre les lignes d'un même ticket).
        receiptId: v.optional(v.id('receipts')),
      }),
    ),
  },
  handler: async (ctx, { monthId, entries, replace }) => {
    const userId = await requireUser(ctx)
    await getOwnedMonth(ctx, userId, monthId)

    // Clés de rubrique valides du propriétaire (on ignore les lignes orphelines).
    const validKeys = new Set(
      (await loadSections(ctx, userId)).map((s) => s.key),
    )

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

    let imported = 0
    for (const e of entries) {
      // On ignore les lignes pointant vers une rubrique inexistante.
      if (!validKeys.has(e.section)) continue
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
        receiptId: e.receiptId,
      })
      imported++
    }

    return { imported }
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

/**
 * Répartition des dépenses RÉELLES par section sur une année (tous mois confondus).
 * Pour l'anneau de répartition annuelle du tableau de bord.
 */
export const yearExpenseBreakdown = query({
  args: { year: v.number() },
  handler: async (ctx, { year }) => {
    const userId = await effectiveOwnerOrNull(ctx)
    if (userId === null) return []
    // Clés « Revenu » à exclure de la répartition des dépenses.
    const income = await incomeKeysFor(ctx, userId)
    const months = await ctx.db
      .query('months')
      .withIndex('by_user_year_month', (q) =>
        q.eq('userId', userId).eq('year', year),
      )
      .collect()
    const totals: Record<string, number> = {}
    for (const m of months) {
      const entries = await ctx.db
        .query('entries')
        .withIndex('by_month', (q) => q.eq('monthId', m._id))
        .collect()
      for (const e of entries) {
        if (income.has(e.section)) continue
        totals[e.section] = (totals[e.section] ?? 0) + e.real
      }
    }
    return Object.entries(totals).map(([section, total]) => ({ section, total }))
  },
})
