# Vider les lignes d'une rubrique dans un mois

## Contexte

Aujourd'hui, pour vider une rubrique d'un mois, l'utilisateur doit supprimer ses lignes une par une (via `EntryDetailDialog`) — ou supprimer la rubrique entière, ce qui détruit ses lignes dans TOUS les mois et n'est pas possible pour les rubriques par défaut (`builtin`). On ajoute une action « Vider » sur chaque carte de rubrique (`SectionCard`) de la page d'un mois : suppression de toutes les lignes de cette rubrique **dans ce mois uniquement**, avec confirmation (action destructive).

## Approche

Tout suit des patterns existants ; deux fichiers à modifier.

### 1. Mutation Convex — `convex/budget.ts`

Nouvelle mutation `clearSectionEntries({ monthId: v.id('months'), section: sectionValidator })`, placée près de `removeEntry` (l.369) :

- `requireUser(ctx)` (= `requireWrite`, propriétaire effectif — compatible budget partagé) puis `getOwnedMonth(ctx, userId, monthId)` (helpers existants du fichier).
- Liste les lignes via l'index existant `by_month_section` (`q.eq('monthId', monthId).eq('section', section)`) — même pattern que `removeSection` dans `convex/sections.ts` l.236-277, mais limité à un mois.
- Supprime chaque ligne en mémorisant les `receiptId` rencontrés, puis appelle `maybeDeleteReceipt(ctx, userId, receiptId)` pour chaque reçu unique APRÈS les suppressions (comptage de références, comme `removeEntry` l.369-380 — contrairement au `replace` d'`importEntries` qui ne gère pas les reçus).
- Retourne `{ removed }`.

### 2. UI — `src/components/MonthView.tsx`

**SectionCard (l.388-537)** :
- État local `clearOpen` (comme `deleteOpen` l.405).
- Dans le `<header>` (l.418-444), avant le bouton Trash2 de suppression de rubrique : un bouton « Vider » visible si `canEdit && entries.length > 0` (s'applique aussi aux rubriques `builtin`, contrairement au Trash2). Icône lucide `Eraser`, mêmes classes hover destructives que le bouton existant (l.436-442), `title="Vider les lignes de cette rubrique pour ce mois"`.
- Rendu conditionnel `{clearOpen && <ClearSectionDialog … />}` à côté des autres modales (l.529-535).

**Nouveau composant `ClearSectionDialog`** (dans MonthView.tsx, à côté de `DeleteSectionDialog` l.773-834, dont il reprend la structure exacte) :
- Props : `{ section, monthId, count, onClose }` — `count = entries.length` connu localement, pas de query de comptage nécessaire.
- Titre `AlertTriangle` + « Vider « {label} » ? » ; texte : « Les **{count} ligne(s)** de cette rubrique pour ce mois seront **définitivement supprimées**. Les autres mois ne sont pas affectés. »
- Boutons : `Annuler` (`app-btn-ghost`) / `Vider` (`app-btn-danger`, spinner `Loader2` pendant `busy`) → `useMutation(api.budget.clearSectionEntries)` puis `onClose()`.
- Ajouter `Eraser` à l'import lucide-react existant en tête de fichier.

## Vérification

1. `npx convex codegen` (régénère l'API + typecheck convex) ; `npx tsc --noEmit` (aucune nouvelle erreur — erreurs préexistantes connues dans `router.tsx`/`tableau.tsx`).
2. `npm run dev` + `npx convex dev` → page d'un mois :
   - le bouton « Vider » apparaît sur une rubrique contenant des lignes (y compris une rubrique par défaut comme « Revenus »), absent si la rubrique est vide ;
   - confirmation → les lignes de la rubrique disparaissent, les autres rubriques et les autres mois sont intacts, les SummaryCards se recalculent ;
   - une ligne avec photo : le reçu partagé par une ligne d'un autre mois n'est PAS supprimé ; un reçu devenu orphelin l'est ;
   - en lecture seule (`canEdit=false`, espace partagé viewer) : bouton masqué.
