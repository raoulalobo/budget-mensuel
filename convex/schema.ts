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
    // Clé de la RUBRIQUE (cf. table `sections`). Historiquement une des valeurs
    // 'income'/'fixed'/'variable'/'credit'/'saving' ; désormais une clé libre
    // (rubriques personnalisables) — d'où `v.string()`.
    section: v.string(),
    label: v.string(),
    budget: v.number(),
    real: v.number(),
    order: v.number(),
    // Reçu/justificatif optionnel (photo partagée entre les lignes d'un ticket).
    receiptId: v.optional(v.id('receipts')),
    // Note libre optionnelle (saisie au clavier ou dictée vocale).
    note: v.optional(v.string()),
    // Étiquettes libres pour la recherche / le filtrage.
    tags: v.optional(v.array(v.string())),
  })
    .index('by_month', ['monthId'])
    .index('by_month_section', ['monthId', 'section'])
    // Pour compter combien de lignes référencent un reçu (nettoyage des fichiers).
    .index('by_receipt', ['receiptId']),

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
    // Clé de rubrique (cf. table `sections`) — clé libre depuis les rubriques
    // personnalisables.
    section: v.string(),
    label: v.string(),
    amount: v.number(),
  }).index('by_user', ['userId']),

  /**
   * ─────────────────────── BUDGET PARTAGÉ ───────────────────────
   *
   * Principe (par délégation, sans migration des données existantes) :
   *  - Chaque utilisateur possède son propre « espace budget », identifié par
   *    SON userId : c'est le `ownerId`. Toutes les données (months, entries,
   *    assets…) restent estampillées avec le userId du PROPRIÉTAIRE de l'espace.
   *  - Un utilisateur peut être invité dans l'espace d'un autre (membre) avec un
   *    rôle (éditeur = modifie, lecteur = consultation seule).
   *  - À tout instant, un utilisateur « regarde » un espace (le sien par défaut,
   *    ou un espace partagé) : c'est l'espace actif. Les requêtes de données
   *    utilisent le `ownerId` de l'espace actif au lieu du userId connecté.
   */

  /**
   * Appartenance d'un utilisateur à l'espace budget d'un propriétaire.
   * Le propriétaire (ownerId) n'a PAS de ligne ici : il est implicitement
   * « owner » de son propre espace. Une ligne = un invité accepté.
   * Exemple : { ownerId: Alice, memberId: Bob, role: 'editor' }
   *   → Bob peut modifier le budget d'Alice.
   */
  budgetMembers: defineTable({
    ownerId: v.id('users'), // propriétaire de l'espace partagé
    memberId: v.id('users'), // utilisateur invité ayant accès
    role: v.union(v.literal('editor'), v.literal('viewer')),
  })
    .index('by_owner', ['ownerId']) // lister les membres d'un espace
    .index('by_member', ['memberId']) // lister les espaces où je suis invité
    .index('by_owner_member', ['ownerId', 'memberId']), // vérifier un accès précis

  /**
   * Invitation par CODE : le propriétaire génère un code à usage (ré)utilisable
   * que l'invité saisit pour rejoindre l'espace avec le rôle prévu.
   * Le code est supprimé une fois consommé (usage unique).
   * Exemple : { ownerId: Alice, code: 'ABX7-K9P2', role: 'editor' }
   */
  budgetInvites: defineTable({
    ownerId: v.id('users'),
    code: v.string(),
    role: v.union(v.literal('editor'), v.literal('viewer')),
  })
    .index('by_code', ['code']) // résoudre un code saisi
    .index('by_owner', ['ownerId']), // lister/révoquer les invitations d'un espace

  /**
   * Espace budget actuellement sélectionné par un utilisateur.
   * Absence de ligne (ou ownerId === userId) ⇒ l'utilisateur regarde SON espace.
   * Exemple : { userId: Bob, ownerId: Alice } → Bob regarde le budget d'Alice.
   */
  activeBudget: defineTable({
    userId: v.id('users'),
    ownerId: v.id('users'),
  }).index('by_user', ['userId']),

  /**
   * Profil utilisateur (données de compte complémentaires à la table `users`
   * d'auth, qu'on évite de modifier directement). Aujourd'hui : l'AVATAR, stocké
   * comme fichier (file storage Convex). Le pseudo, lui, vit dans `users.name`.
   * Exemple : { userId: Alice, avatarId: <_storage> }.
   */
  userProfiles: defineTable({
    userId: v.id('users'),
    avatarId: v.optional(v.id('_storage')),
    // Devise de l'espace budget de CE propriétaire (code ISO 4217 : 'EUR',
    // 'USD', 'XAF'…). Optionnel ⇒ aucune migration des lignes existantes ;
    // absent ⇒ repli 'EUR' (cf. convex/settings.ts et src/lib/useCurrency.ts).
    currency: v.optional(v.string()),
  }).index('by_user', ['userId']),

  /**
   * RUBRIQUES (sections) personnalisables, par propriétaire d'espace budget.
   *
   * Chaque rubrique décrit une clé (`key`) stockée dans `entries.section` /
   * `recurringLines.section`. `kind` indique si elle compte comme Revenu ou
   * Dépense (pour le calcul du Net). `builtin` marque les rubriques par défaut
   * non supprimables (Revenus + Dépenses fixes). `order` = ordre d'affichage.
   * Exemple : { userId, key:'income', label:'Revenus', kind:'income', builtin:true }.
   */
  sections: defineTable({
    userId: v.id('users'),
    key: v.string(),
    label: v.string(),
    color: v.string(),
    kind: v.union(v.literal('income'), v.literal('expense')),
    order: v.number(),
    builtin: v.boolean(),
  })
    .index('by_user', ['userId'])
    .index('by_user_key', ['userId', 'key']),
})
