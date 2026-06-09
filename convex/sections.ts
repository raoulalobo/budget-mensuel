import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { effectiveOwnerOrNull, requireWrite } from './sharing'

/**
 * RUBRIQUES (sections) personnalisables.
 *
 * Chaque rubrique décrit une `key` stockée dans `entries.section`. `kind`
 * détermine si elle compte comme Revenu ou Dépense (calcul du Net). Les
 * rubriques `builtin` (Revenus + Dépenses fixes) ne sont pas supprimables.
 * Toutes les fonctions ciblent le PROPRIÉTAIRE EFFECTIF de l'espace budget
 * (lecture via `effectiveOwnerOrNull`, écriture via `requireWrite`).
 */

const kindValidator = v.union(v.literal('income'), v.literal('expense'))

/** Rubriques par défaut, créées pour chaque propriétaire (clés historiques). */
const DEFAULT_SECTIONS: Array<{
  key: string
  label: string
  color: string
  kind: 'income' | 'expense'
  builtin: boolean
}> = [
  { key: 'income', label: 'Revenus', color: '#16a34a', kind: 'income', builtin: true },
  { key: 'fixed', label: 'Dépenses fixes', color: '#2563eb', kind: 'expense', builtin: true },
  { key: 'variable', label: 'Dépenses variables', color: '#f59e0b', kind: 'expense', builtin: false },
  { key: 'credit', label: 'Crédits', color: '#dc2626', kind: 'expense', builtin: false },
  { key: 'saving', label: 'Épargne', color: '#7c3aed', kind: 'expense', builtin: false },
]

// Palette d'accent pour les rubriques créées (couleur auto, à la création).
const PALETTE = [
  '#0ea5e9', '#db2777', '#65a30d', '#ea580c', '#7c3aed',
  '#0d9488', '#ca8a04', '#9333ea', '#e11d48', '#2dd4bf',
]

// ───────────────────────────────────────────────────────────────────────────
// Helpers réutilisés par budget.ts
// ───────────────────────────────────────────────────────────────────────────

/** Charge les rubriques d'un propriétaire, triées par `order`. */
export async function loadSections(
  ctx: QueryCtx | MutationCtx,
  ownerId: Id<'users'>,
): Promise<Array<Doc<'sections'>>> {
  const rows = await ctx.db
    .query('sections')
    .withIndex('by_user', (q) => q.eq('userId', ownerId))
    .collect()
  rows.sort((a, b) => a.order - b.order)
  return rows
}

/** Ensemble des clés de rubrique « Revenu » d'un propriétaire (pour le Net). */
export async function incomeKeysFor(
  ctx: QueryCtx | MutationCtx,
  ownerId: Id<'users'>,
): Promise<Set<string>> {
  const rows = await loadSections(ctx, ownerId)
  const set = new Set<string>()
  for (const r of rows) if (r.kind === 'income') set.add(r.key)
  // Repli : si aucune rubrique n'est encore seedée, 'income' reste un revenu.
  if (rows.length === 0) set.add('income')
  return set
}

/** Vérifie qu'une clé de rubrique existe pour le propriétaire (anti-orphelines). */
export async function sectionExists(
  ctx: QueryCtx | MutationCtx,
  ownerId: Id<'users'>,
  key: string,
): Promise<boolean> {
  const row = await ctx.db
    .query('sections')
    .withIndex('by_user_key', (q) => q.eq('userId', ownerId).eq('key', key))
    .first()
  return !!row
}

/**
 * Crée les rubriques par défaut si le propriétaire n'en a aucune. Idempotent.
 * Renvoie le nombre de rubriques créées.
 */
async function seedDefaults(
  ctx: MutationCtx,
  ownerId: Id<'users'>,
): Promise<number> {
  const existing = await ctx.db
    .query('sections')
    .withIndex('by_user', (q) => q.eq('userId', ownerId))
    .first()
  if (existing) return 0
  let order = 0
  for (const s of DEFAULT_SECTIONS) {
    await ctx.db.insert('sections', { userId: ownerId, order: order++, ...s })
  }
  return DEFAULT_SECTIONS.length
}

// ───────────────────────────────────────────────────────────────────────────
// QUERIES
// ───────────────────────────────────────────────────────────────────────────

/** Liste les rubriques du propriétaire effectif, triées par ordre d'affichage. */
export const listSections = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await effectiveOwnerOrNull(ctx)
    if (ownerId === null) return []
    return await loadSections(ctx, ownerId)
  },
})

/**
 * Compte d'utilisation d'une rubrique : nombre de lignes et de mois concernés.
 * Sert à la confirmation de suppression.
 */
export const sectionUsage = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const ownerId = await effectiveOwnerOrNull(ctx)
    if (ownerId === null) return { lines: 0, months: 0 }
    const months = await ctx.db
      .query('months')
      .withIndex('by_user_year_month', (q) => q.eq('userId', ownerId))
      .collect()
    let lines = 0
    let monthsCount = 0
    for (const m of months) {
      const entries = await ctx.db
        .query('entries')
        .withIndex('by_month_section', (q) =>
          q.eq('monthId', m._id).eq('section', key),
        )
        .collect()
      if (entries.length > 0) {
        lines += entries.length
        monthsCount += 1
      }
    }
    return { lines, months: monthsCount }
  },
})

// ───────────────────────────────────────────────────────────────────────────
// MUTATIONS
// ───────────────────────────────────────────────────────────────────────────

/** Crée les rubriques par défaut si nécessaire (idempotent). */
export const ensureDefaults = mutation({
  args: {},
  handler: async (ctx) => {
    const ownerId = await requireWrite(ctx)
    return { created: await seedDefaults(ctx, ownerId) }
  },
})

/** Génère une clé de rubrique unique pour le propriétaire. */
async function makeUniqueKey(
  ctx: MutationCtx,
  ownerId: Id<'users'>,
): Promise<string> {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  for (let attempt = 0; attempt < 8; attempt++) {
    let k = 'c'
    for (let i = 0; i < 7; i++) {
      k += alphabet[Math.floor(Math.random() * alphabet.length)]
    }
    if (!(await sectionExists(ctx, ownerId, k))) return k
  }
  // Repli extrêmement improbable.
  return 'c' + Math.floor(Math.random() * 1e9).toString(36)
}

/** Crée une nouvelle rubrique (type Revenu/Dépense au choix). */
export const createSection = mutation({
  args: {
    label: v.string(),
    kind: kindValidator,
    color: v.optional(v.string()),
  },
  handler: async (ctx, { label, kind, color }) => {
    const ownerId = await requireWrite(ctx)
    // S'assure que les rubriques par défaut existent (premier usage).
    await seedDefaults(ctx, ownerId)

    const trimmed = label.trim()
    if (!trimmed) throw new Error('Le nom de la rubrique est requis')

    const existing = await loadSections(ctx, ownerId)
    const order = existing.reduce((mx, s) => Math.max(mx, s.order), -1) + 1
    const key = await makeUniqueKey(ctx, ownerId)
    const finalColor = color || PALETTE[existing.length % PALETTE.length]

    return await ctx.db.insert('sections', {
      userId: ownerId,
      key,
      label: trimmed,
      color: finalColor,
      kind,
      order,
      builtin: false,
    })
  },
})

/** Met à jour une rubrique (libellé, couleur, type, ordre). */
export const updateSection = mutation({
  args: {
    id: v.id('sections'),
    label: v.optional(v.string()),
    color: v.optional(v.string()),
    kind: v.optional(kindValidator),
    order: v.optional(v.number()),
  },
  handler: async (ctx, { id, label, color, kind, order }) => {
    const ownerId = await requireWrite(ctx)
    const sec = await ctx.db.get(id)
    if (!sec || sec.userId !== ownerId) throw new Error('Rubrique introuvable')
    const patch: Partial<Doc<'sections'>> = {}
    if (label !== undefined && label.trim()) patch.label = label.trim()
    if (color !== undefined) patch.color = color
    if (kind !== undefined) patch.kind = kind
    if (order !== undefined) patch.order = order
    await ctx.db.patch(id, patch)
  },
})

/**
 * Supprime une rubrique NON par défaut, ainsi que TOUTES ses lignes (dans tous
 * les mois du propriétaire) et ses lignes récurrentes. Irréversible.
 */
export const removeSection = mutation({
  args: { id: v.id('sections') },
  handler: async (ctx, { id }) => {
    const ownerId = await requireWrite(ctx)
    const sec = await ctx.db.get(id)
    if (!sec || sec.userId !== ownerId) throw new Error('Rubrique introuvable')
    if (sec.builtin) {
      throw new Error('Cette rubrique par défaut ne peut pas être supprimée')
    }

    // Lignes de budget portant cette clé, dans tous les mois du propriétaire.
    const months = await ctx.db
      .query('months')
      .withIndex('by_user_year_month', (q) => q.eq('userId', ownerId))
      .collect()
    let removed = 0
    for (const m of months) {
      const entries = await ctx.db
        .query('entries')
        .withIndex('by_month_section', (q) =>
          q.eq('monthId', m._id).eq('section', sec.key),
        )
        .collect()
      for (const e of entries) {
        await ctx.db.delete(e._id)
        removed++
      }
    }

    // Lignes récurrentes de cette rubrique.
    const recurring = await ctx.db
      .query('recurringLines')
      .withIndex('by_user', (q) => q.eq('userId', ownerId))
      .collect()
    for (const r of recurring) {
      if (r.section === sec.key) await ctx.db.delete(r._id)
    }

    await ctx.db.delete(id)
    return { removedLines: removed }
  },
})
