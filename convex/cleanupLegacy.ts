import { mutation } from './_generated/server'

/**
 * TEMPORAIRE — purge des tables « Avoir/Épargne » (assets, assetHistory,
 * savingsGoals) avant leur retrait définitif du schéma. À supprimer une fois
 * exécutée (en local ET en prod). Sans authentification : usage interne via
 * `convex run` uniquement.
 */
export const purge = mutation({
  args: {},
  handler: async (ctx) => {
    let deleted = 0
    for (const table of ['assets', 'assetHistory', 'savingsGoals'] as const) {
      const rows = await ctx.db.query(table).collect()
      for (const r of rows) {
        await ctx.db.delete(r._id)
        deleted++
      }
    }
    return { deleted }
  },
})
