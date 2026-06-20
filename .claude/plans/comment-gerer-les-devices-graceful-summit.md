# Plan — Gérer plusieurs devises (EUR / USD / XAF…)

## Context

Aujourd'hui l'app est **mono-devise EUR, codée en dur**. Tout l'affichage monétaire
passe par une unique fonction `formatEUR()` dans `src/lib/budget.ts`
(`Intl.NumberFormat('fr-FR', { currency: 'EUR' })`). Le **stockage est déjà
agnostique** : les montants sont de simples `v.number()` (`entries.budget/real`,
`recurringLines.amount`) — aucune devise nulle part, aucun calcul à changer.

Des utilisateurs travaillent en USD, d'autres en EUR, d'autres en XAF (FCFA).
**Décisions retenues (validées avec l'utilisateur) :**
- **Une seule devise par budget** — pas de conversion, pas de taux de change. On
  change uniquement l'affichage (symbole + format).
- **Devise rattachée au propriétaire effectif** du budget (cohérent avec le
  scoping budget partagé : `effectiveOwnerOrNull` / `requireWrite`). Un budget
  partagé = une devise, identique pour tous les membres qui le regardent.

Résultat attendu : chaque propriétaire choisit sa devise dans la page Profil ;
tous les montants de son espace (et de ses invités) s'affichent dans cette devise.

## Approche

1. Stocker la devise sur le profil du propriétaire (`userProfiles.currency`).
2. Généraliser le formatage : `formatMoney(value, currency)` (devise-agnostique),
   exposé côté client par un hook `useCurrency()` calqué sur `useSections()`.
3. Remplacer tous les `formatEUR(x)` d'affichage par le format du hook.
4. Ajouter un sélecteur de devise dans la page Profil (réservé aux éditeurs).

Aucune migration de données : devise absente ⇒ repli EUR (comportement actuel).

## Modifications

### 1. Schéma — `convex/schema.ts`
Ajouter un champ optionnel à `userProfiles` :
```ts
userProfiles: defineTable({
  userId: v.id('users'),
  avatarId: v.optional(v.id('_storage')),
  currency: v.optional(v.string()), // code ISO 4217 ('EUR','USD','XAF'). Absent ⇒ EUR.
}).index('by_user', ['userId']),
```
`v.optional` ⇒ pas de migration, les lignes existantes restent valides.

### 2. Backend — nouveau `convex/settings.ts`
La devise est **scopée au propriétaire effectif** (pas à l'utilisateur connecté),
contrairement à tout `convex/users.ts` qui est volontairement « self only ». On
isole donc ces deux fonctions dans un fichier dédié, en réutilisant les helpers
de `convex/sharing.ts` :

- `getCurrency` (query) : `effectiveOwnerOrNull(ctx)` → lit la ligne `userProfiles`
  de ce owner via l'index `by_user` → renvoie `profile?.currency ?? 'EUR'`.
- `setCurrency` (mutation, `args: { currency: v.string() }`) : `requireWrite(ctx)`
  (bloque les lecteurs) → valide que le code ∈ liste connue → `patch`/`insert` la
  ligne `userProfiles` du owner (même logique create-or-update que `setAvatar`
  dans `users.ts:84`).

### 3. Lib partagée — `src/lib/budget.ts`
Remplacer le bloc `eurFormatter` / `formatEUR` (lignes 42-54) par un formateur
générique, **sans forcer 2 décimales** (laisser `Intl` choisir : EUR/USD→2, XAF→0) :

```ts
/** Devises proposées dans l'UI (code ISO 4217 + libellé). */
export const CURRENCIES = [
  { code: 'EUR', label: 'Euro (€)' },
  { code: 'USD', label: 'Dollar US ($)' },
  { code: 'XAF', label: 'Franc CFA BEAC (FCFA)' },
  { code: 'XOF', label: 'Franc CFA BCEAO (FCFA)' },
  { code: 'GBP', label: 'Livre sterling (£)' },
  { code: 'CHF', label: 'Franc suisse (CHF)' },
  { code: 'CAD', label: 'Dollar canadien (CA$)' },
  { code: 'MAD', label: 'Dirham marocain (MAD)' },
] as const

const formatters = new Map<string, Intl.NumberFormat>()
function formatterFor(currency: string) {
  let f = formatters.get(currency)
  if (!f) {
    f = new Intl.NumberFormat('fr-FR', { style: 'currency', currency })
    formatters.set(currency, f)
  }
  return f
}

/** Formate un montant dans la devise donnée (repli EUR). Ex: formatMoney(6043.4,'XAF') => "6 043 FCFA". */
export function formatMoney(value: number, currency = 'EUR'): string {
  return formatterFor(currency).format(value ?? 0)
}
```
Garder un alias rétro-compatible le temps de la migration :
`export const formatEUR = (v: number) => formatMoney(v, 'EUR')` (utilisé par les
modules purs et la landing). Les calculs (`computeSummary`, `sectionTotals`)
restent inchangés (agnostiques).

### 4. Hook client — nouveau `src/lib/useCurrency.ts` (calqué sur `useSections.ts`)
```ts
export function useCurrency() {
  const currency = (useQuery(api.settings.getCurrency) as string | undefined) ?? 'EUR'
  return {
    currency,
    loading: currency === undefined,
    format: (v: number) => formatMoney(v, currency),
  }
}
```

### 5. Câblage UI — remplacer `formatEUR` par le format du hook
Dans chaque **composant/route React**, ajouter `const { format: fmt } = useCurrency()`
et remplacer les appels `formatEUR(x)` → `fmt(x)` :
- `src/components/SummaryCards.tsx`
- `src/components/MonthView.tsx` (cartes, alerte dépassement, sous-totaux, `Diff`)
- `src/components/AddEntryDialog.tsx`, `src/components/EntryDetailDialog.tsx`
- `src/routes/mois.index.tsx`, `src/routes/tableau.tsx` (dont les `Tooltip` Recharts)

Cas particuliers :
- `src/routes/index.tsx` : **landing publique** (maquette démo, pas de contexte
  utilisateur) → laisser sur `formatEUR` (EUR fixe). 
- `src/lib/pdf.ts` (module pur, pas de hook) : ajouter `currency` aux options
  d'export et faire `formatMoney(x, opts.currency)` ; le composant appelant lit
  `currency` via `useCurrency()` et le passe.

### 6. Sélecteur de devise — `src/routes/profil.tsx`
Ajouter une section « Devise » : un `<select>` alimenté par `CURRENCIES`, valeur
courante via `useCurrency()`, `onChange` → mutation `settings.setCurrency`.
Désactiver/masquer pour les lecteurs (réutiliser le rôle via `src/lib/budgetRole.tsx`,
comme les autres actions en écriture).

## Notes / cas limites
- **Décimales** : `Intl` gère seul le nombre de décimales par devise (XAF = 0).
  Les inputs `type="number" step="0.01"` restent génériques ; saisir des décimales
  en XAF est sans effet visible (arrondi à l'affichage) — acceptable, pas bloquant.
- **`parseAmount`** (`src/lib/csv.ts`) supprime déjà `€`/`$` ; rien à changer pour
  l'import. (Amélioration optionnelle non incluse : détecter d'autres symboles.)
- **Pas de conversion** : changer de devise ne recalcule rien, ré-étiquette juste
  les montants (choix assumé : un budget = une devise).

## Vérification (e2e, app lancée — cf. mémoire « tester-features-en-vrai »)
1. Démarrer l'app (TanStack Start + Convex local, cf. mémoire stack).
2. Page **Profil** → changer la devise en **XAF** : vérifier que tous les montants
   (vue mois, `SummaryCards`, tableau annuel, tooltips graphiques, dialogues) passent
   en « FCFA » **sans décimales**, sans recalcul des nombres.
3. Repasser en **USD** puis **EUR** : symbole/format suivent, valeurs identiques.
4. **Budget partagé** : un invité (lecteur) qui regarde l'espace voit la devise du
   **propriétaire** ; le sélecteur lui est désactivé. Un invité **éditeur** peut la
   changer et l'impacte pour tous.
5. **Export PDF** : le PDF reprend la devise active.
6. Nouveau compte (aucune ligne `userProfiles`) : repli **EUR** par défaut.
