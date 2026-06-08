import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { authTables } from '@convex-dev/auth/server'

/**
 * Schéma de la base Convex pour l'application "Budget mensuel".
 *
 * On y trouve :
 *  - `...authTables` : tables fournies par Convex Auth (users, sessions...)
 *  - `months`        : un mois budgétaire pour un utilisateur (ex. Janvier 2025)
 *  - `entries`       : chaque ligne d'un mois (un salaire, une dépense, un crédit...)
 *  - `assets`        : le patrimoine / placements de l'onglet "Avoir"
 *
 * Le modèle reproduit la structure de la feuille Google Sheets :
 *   Revenus / Dépenses fixes / Dépenses variables / Crédits / Épargne —
 *   chaque ligne ayant un montant "budget" (prévu) et "real" (réel),
 *   exactement comme les colonnes du tableur.
 */
export default defineSchema({
  // Tables d'authentification (users, authAccounts, authSessions, ...).
  ...authTables,

  /**
   * Un mois budgétaire appartenant à un utilisateur.
   * Exemple : { userId, year: 2025, month: 1 } => "Janvier 2025".
   * L'unicité (userId, year, month) est garantie côté logique applicative.
   */
  months: defineTable({
    userId: v.id('users'),
    year: v.number(), // ex. 2025
    month: v.number(), // 1 = Janvier ... 12 = Décembre
  }).index('by_user_year_month', ['userId', 'year', 'month']),

  /**
   * Une ligne de budget rattachée à un mois.
   * `section` regroupe les lignes comme dans la feuille :
   *   income / fixed / variable / credit / saving.
   * `budget` = montant prévu, `real` = montant réellement constaté.
   * `order` conserve l'ordre d'affichage des lignes.
   */
  entries: defineTable({
    userId: v.id('users'),
    monthId: v.id('months'),
    section: v.union(
      v.literal('income'),
      v.literal('fixed'),
      v.literal('variable'),
      v.literal('credit'),
      v.literal('saving'),
    ),
    label: v.string(),
    budget: v.number(),
    real: v.number(),
    order: v.number(),
    // Reçu/justificatif optionnel (photo partagée entre les lignes d'un ticket).
    receiptId: v.optional(v.id('receipts')),
    // Note libre optionnelle (saisie au clavier ou dictée vocale).
    note: v.optional(v.string()),
  })
    .index('by_month', ['monthId'])
    .index('by_month_section', ['monthId', 'section'])
    // Pour compter combien de lignes référencent un reçu (nettoyage des fichiers).
    .index('by_receipt', ['receiptId']),

  /**
   * Patrimoine / placements de l'utilisateur (onglet "Avoir").
   * Exemple : { label: "Livret A", amount: 3000 }.
   * Montants "instantanés", indépendants d'un mois précis.
   */
  assets: defineTable({
    userId: v.id('users'),
    label: v.string(),
    amount: v.number(),
    order: v.number(),
  }).index('by_user', ['userId']),

  /**
   * Reçu / justificatif : un fichier image stocké UNE fois (file storage Convex),
   * partagé par toutes les lignes issues d'un même ticket. Les lignes pointent
   * vers ce reçu via `entries.receiptId`. Le fichier n'est supprimé que lorsque
   * plus aucune ligne ne le référence (comptage de références).
   */
  receipts: defineTable({
    userId: v.id('users'),
    storageId: v.id('_storage'),
  }).index('by_user', ['userId']),

  /**
   * Lignes récurrentes : modèles de lignes (loyer, abonnements…) que l'utilisateur
   * applique chaque mois en un clic. `amount` = montant prévu par défaut.
   */
  recurringLines: defineTable({
    userId: v.id('users'),
    section: v.union(
      v.literal('income'),
      v.literal('fixed'),
      v.literal('variable'),
      v.literal('credit'),
      v.literal('saving'),
    ),
    label: v.string(),
    amount: v.number(),
  }).index('by_user', ['userId']),

  /**
   * Objectifs d'épargne de l'utilisateur.
   * Exemple : { label: "Fonds d'urgence", target: 5000, current: 1200 }.
   *  - `target`  : montant visé
   *  - `current` : montant déjà épargné
   * La progression (current / target) est calculée côté affichage.
   */
  savingsGoals: defineTable({
    userId: v.id('users'),
    label: v.string(),
    target: v.number(),
    current: v.number(),
    order: v.number(),
  }).index('by_user', ['userId']),
})
