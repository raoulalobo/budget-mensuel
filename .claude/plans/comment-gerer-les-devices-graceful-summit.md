# Plan — Date optionnelle sur les lignes de budget (dépenses / revenus)

## Context

L'app est un **planificateur budgétaire mensuel** : chaque ligne `entries` est un
poste avec un montant prévu (`budget`) et réel (`real`) pour **tout le mois**. La
granularité temporelle est le mois (`months.year/month`) ; les lignes sont triées
par `order` (ordre manuel). **Aucune date** n'existe au niveau de la ligne.

Problème soulevé : une date est un élément essentiel pour les dépenses/revenus
ponctuels. Constat clé : l'**import photo** (`convex/vision.ts`) *détecte déjà* la
date du ticket/facture mais la perd dans la `note` (texte libre).

**Décisions retenues (validées) :**
- **Date OPTIONNELLE par ligne** (métadonnée) — on garde le modèle mensuel intact ;
  les lignes fixes peuvent rester sans date, les ponctuelles en ont une.
- **Format date complète `YYYY-MM-DD`** (stockage ISO, triable, gère le cas rare
  d'une dépense du mois voisin).
- Usages : **tri/affichage chronologique**, **auto-remplissage à l'import photo**,
  **filtre/recherche par date**, **contexte IA** (récap + assistant).

Aucune migration : champ optionnel ⇒ les lignes existantes restent valides (sans date).

## Modifications

### 1. Schéma — `convex/schema.ts`
Ajouter à `entries` un champ optionnel :
```ts
// Date de la dépense/revenu au format ISO 'YYYY-MM-DD'. Optionnel : les lignes
// agrégées/fixes (loyer…) peuvent ne pas en avoir. Pas d'index : le filtre/tri
// se fait en mémoire sur les lignes déjà chargées d'un mois (faible volume).
date: v.optional(v.string()),
```
Pas de nouvel index nécessaire (`getMonth` charge déjà toutes les lignes d'un mois,
volume faible → tri/filtre en mémoire côté client).

### 2. Helpers date — `src/lib/budget.ts` et `src/lib/csv.ts`
- `src/lib/budget.ts` : `formatDate(iso?: string)` → `"15/01/2025"` via
  `Intl.DateTimeFormat('fr-FR')` (repli `''` si absent/invalide), à côté de
  `formatMoney`. Et `isValidISODate(s)` (regex `^\d{4}-\d{2}-\d{2}$` + `Date` valide).
- `src/lib/csv.ts` : `parseDate(raw: string): string | undefined` — convertit
  `"15/01/2025"`, `"2025-01-15"`, `"15-01-25"`… en ISO `YYYY-MM-DD` (repli `undefined`
  si illisible), pendant équivalent de `parseAmount`.

### 3. Mutations — `convex/budget.ts`
- `addEntry` : ajouter l'arg `date: v.optional(v.string())`, le valider
  (`isValidISODate` côté serveur, sinon ignorer), et le stocker.
- `updateEntry` : ajouter `date: v.optional(v.union(v.string(), v.null()))`.
  Nuance importante : le handler filtre déjà les `undefined` ; pour **effacer** une
  date il faut accepter `null` et le convertir en `date: undefined` dans le patch
  (sinon la date ne peut jamais être retirée).
- `importEntries` : ajouter `date: v.optional(v.string())` dans l'objet `entries[]`
  et le propager à l'`insert`.
- `duplicateMonth` : **ne PAS copier** `date` (une date de janvier n'a pas de sens
  en février — même logique que `resetReal`).
- `applyRecurring` (`convex/recurring.ts`) : inchangé (lignes récurrentes sans date).

### 4. Import photo (date détectée) — `convex/vision.ts`
- Prompt : demander un champ `date` ISO `YYYY-MM-DD` au niveau `summary` (date du
  document) **et** par ligne `entries[].date` quand le document en porte plusieurs
  (ex. relevé bancaire) ; n'inventer aucune date.
- Étendre l'interface `Summary` avec `date?: string` et `ExtractedRow` avec
  `date?: string` ; parser/valider (réutiliser une validation ISO), repli sur la
  date du document. Renvoyer ces dates.
- Flux mono-ligne (`AddEntryDialog`) : pré-remplir le champ date depuis `summary.date`.
- Flux multi-lignes (`PhotoImportDialog`) : appliquer la date de chaque ligne
  (ou la date document) aux lignes éditables, puis la passer à `importEntries`.

### 5. Import CSV/Excel — `src/lib/smartImport/*` + `src/lib/csv.ts`
- `types.ts` : `ImportMapping` reçoit `dateColumn?: number` ; `ParsedEntry` (csv.ts)
  reçoit `date?: string`.
- `applyMapping.ts` : si `dateColumn` défini, lire la cellule et la convertir via
  `parseDate` ; poser `date` sur la ligne produite.
- `SmartImportDialog.tsx` : permettre de mapper une colonne date (mode manuel) et
  l'afficher dans l'aperçu éditable. (Détection auto par l'IA de mapping :
  amélioration optionnelle, hors périmètre initial — mapping manuel suffit.)

### 6. UI saisie & affichage
- `AddEntryDialog.tsx` : ajouter un `<input type="date">` optionnel. Recevoir le
  contexte mois (year/month) depuis `SectionCard`/`MonthView` pour proposer un
  défaut cohérent (jour courant si le mois affiché = mois en cours, sinon vide) et
  le passer à `addEntry`.
- `EntryDetailDialog.tsx` : champ date éditable (sauvegarde au blur comme `note`/
  `tags`, via `updateEntry`) + bouton « effacer » (envoie `date: null`).
- `MonthView.tsx` :
  - `EntryRow` : afficher la date si présente (puce compacte dans la cellule POSTE,
    via `formatDate`).
  - `matchSearch` (l.~377) : inclure la date (ISO + formatée) dans le texte cherché
    pour filtrer par « 15/01 » ou « 2025-01 ».
  - Ajouter une bascule de tri « par ordre / par date » (tri en mémoire sur les
    lignes déjà chargées ; `order` reste le défaut).

### 7. Contexte IA — `convex/recap.ts` & `convex/assistant.ts`
Quand une ligne a une `date`, l'inclure dans le texte fourni à l'IA, ex. :
`- [section] label (15/01) : prévu X, réel Y`. Petit ajout dans les boucles qui
construisent `dataText`/`ctxText`.

## Fichiers principaux
- `convex/schema.ts`, `convex/budget.ts`, `convex/vision.ts`, `convex/recap.ts`,
  `convex/assistant.ts`
- `src/lib/budget.ts`, `src/lib/csv.ts`, `src/lib/smartImport/types.ts`,
  `src/lib/smartImport/applyMapping.ts`
- `src/components/AddEntryDialog.tsx`, `EntryDetailDialog.tsx`, `MonthView.tsx`,
  `SmartImportDialog.tsx`, `PhotoImportDialog.tsx`

## Notes / cas limites
- **Effacement** : `updateEntry` doit accepter `null` pour vraiment retirer la date
  (le filtre `undefined` existant empêcherait l'effacement).
- **Hors-mois** : on n'impose PAS que la date tombe dans le mois (choix assumé :
  une dépense du mois voisin reste autorisée). Validation = format ISO valide.
- **Pas d'index** : volumes par mois faibles ; tri/filtre en mémoire — pas de
  `by_month_date` pour l'instant (à ajouter seulement si besoin de perf futur).
- **Rétrocompat** : lignes sans date → affichage neutre (pas de puce), tri par date
  les place après celles datées (ou avant, à fixer : `date ?? ''`).

## Vérification (e2e, app lancée — cf. mémoire « tester-features-en-vrai »)
1. Démarrer l'app (Convex local 3212/3213 + `npm run dev`, cf. mémoire stack).
2. **Saisie** : ajouter une dépense avec une date → la date s'affiche dans la ligne ;
   l'éditer/effacer via la modale détail.
3. **Tri/filtre** : basculer le tri « par date » ; rechercher « 15/01 » filtre bien.
4. **Import photo** : importer un ticket daté → la date détectée pré-remplit le champ
   (vérifier qu'elle n'est plus seulement dans la note).
5. **Import CSV** : mapper une colonne date → dates présentes dans l'aperçu et après
   import.
6. **IA** : générer un récap → les dates apparaissent dans le raisonnement quand utiles.
7. **Rétrocompat** : un mois existant (lignes sans date) s'affiche normalement.
8. `npx tsc --noEmit` (0 erreur sur les fichiers touchés) + `npm test`.
