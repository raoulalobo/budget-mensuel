import { mutation } from './_generated/server'
import { getAuthUserId } from '@convex-dev/auth/server'
import type { Id } from './_generated/dataModel'

// Sections de budget (identique à src/lib/budget.ts, redéfini ici pour que le
// bundler Convex n'importe pas de code front).
type Section = 'income' | 'fixed' | 'variable' | 'credit' | 'saving'

/**
 * Pré-remplissage de la base avec des données de DÉMONSTRATION FICTIVES
 * (Janvier 2025 : revenus, dépenses, crédits + patrimoine de l'onglet "Avoir").
 *
 * Ces chiffres sont inventés et ne correspondent à personne — ils servent
 * uniquement à présenter l'application avec un mois rempli.
 *
 * Idempotent : si l'utilisateur possède déjà des mois, on ne fait rien
 * (évite les doublons si on relance le seed). Les 11 autres mois de 2025 sont
 * créés vides (prêts à être remplis).
 */

// Une ligne du seed : libellé, montant prévu, montant réel.
type SeedLine = [label: string, budget: number, real: number]

// Données de Janvier 2025, section par section.
const JANUARY: Record<Section, SeedLine[]> = {
  income: [
    ['Salaire', 2500.0, 2500.0],
    ['Prime', 200.0, 200.0],
  ],
  fixed: [
    ['Loyer', 800.0, 800.0],
    ['Électricité', 60.0, 58.0],
    ['Internet', 30.0, 30.0],
    ['Téléphone', 20.0, 20.0],
    ['Assurance habitation', 25.0, 25.0],
    ['Mutuelle', 40.0, 40.0],
    ['Transports', 75.0, 75.0],
    ['Abonnement streaming', 15.0, 15.0],
  ],
  variable: [
    ['Courses alimentaires', 400.0, 380.0],
    ['Restaurants', 120.0, 95.0],
    ['Loisirs', 100.0, 60.0],
    ['Vêtements', 80.0, 0],
    ['Essence', 90.0, 85.0],
  ],
  credit: [
    ['Crédit auto', 250.0, 250.0],
    ['Crédit conso', 120.0, 120.0],
  ],
  saving: [],
}

export const seedDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) throw new Error('Non authentifié')

    // Garde-fou anti-doublon : on ne seed qu'une base vierge.
    const existing = await ctx.db
      .query('months')
      .withIndex('by_user_year_month', (q) => q.eq('userId', userId))
      .first()
    if (existing) {
      return { seeded: false, reason: 'Des données existent déjà' }
    }

    const year = 2025

    // 1) Crée les 12 mois de l'année (vides), garde l'id de Janvier.
    let januaryId: Id<'months'> | null = null
    for (let month = 1; month <= 12; month++) {
      const id = await ctx.db.insert('months', { userId, year, month })
      if (month === 1) januaryId = id
    }

    // 2) Remplit Janvier avec les lignes réelles.
    if (januaryId) {
      for (const section of Object.keys(JANUARY) as Section[]) {
        const lines = JANUARY[section]
        for (let i = 0; i < lines.length; i++) {
          const [label, budget, real] = lines[i]
          await ctx.db.insert('entries', {
            userId,
            monthId: januaryId,
            section,
            label,
            budget,
            real,
            order: i,
          })
        }
      }
    }

    return { seeded: true, months: 12, januaryEntries: true }
  },
})
