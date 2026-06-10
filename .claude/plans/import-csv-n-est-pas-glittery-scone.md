# Import intelligent xls/xlsx/csv avec agent IA

## Contexte

L'import CSV actuel (`ImportDialog.tsx` + `parseBudgetCsv`) exige un format strict (`Section;Libellé;Prévu;Réel`) que les fichiers réels des utilisateurs ne respectent jamais — il est jugé non pertinent. On le **remplace** par un « import intelligent » : l'utilisateur charge n'importe quel fichier **xls/xlsx/csv**, un agent IA (**DeepSeek**, déjà intégré pour l'assistant et le récap) analyse un échantillon et pose des **questions structurées à choix** jusqu'à obtenir un mapping complet vers la structure de la base (entries : section/label/budget/real). Le mapping est ensuite appliqué **de façon déterministe par du code** à toutes les lignes, un aperçu éditable est montré, puis l'import passe par la mutation existante `importEntries`. Cible : **un seul mois** (dialog ouvert depuis la page du mois, comme aujourd'hui).

Décisions utilisateur : remplacer l'ancien import · DeepSeek · questions structurées · mono-mois.

## Architecture

```
Client (SmartImportDialog)                       Convex
1. parseFileToTable (csv natif / xlsx lazy)
   → string[][]
2. échantillon ≤ 20 lignes ───────────────► action importMapping.analyzeImport (DeepSeek)
3. questions ◄──────────────────────────── { status:'questions', questions[] }
   réponses utilisateur ──────────────────► (re-appel, answers cumulées, max 3 tours)
4. mapping ◄─────────────────────────────── { status:'mapping', mapping, confidence, notes }
5. applyMapping (fonction PURE, toutes les lignes)
6. aperçu éditable (pattern PhotoImportDialog)
7. importEntries (mutation existante, inchangée)
```

Principes : clé API uniquement côté Convex ; l'IA ne voit que l'échantillon et ne produit **que le mapping JSON**, jamais les données transformées ; transformation = code pur testable ; action stateless (le client cumule les réponses, comme `assistant.ts`).

## Fichiers

### À créer
| Fichier | Rôle |
|---|---|
| `src/lib/smartImport/types.ts` | Protocole TS partagé (importé en `import type` par client et action Convex) : `ImportSample`, `ImportQuestion {id, text, options[], allowFreeText?}`, `ImportAnswer`, `SectionStrategy` (`fixed` \| `column`+valueMap+fallback \| `rules`+fallback), `ImportMapping` (headerRows, labelColumn, budgetColumn\|null, realColumn\|null, singleAmountTarget 'both'\|'budget'\|'real', section, skipRowIndexes, ignoreLabelContains, signConvention 'absolute'\|'negative-is-expense'), `AnalyzeImportResult` (`questions` \| `mapping` \| `error`) |
| `src/lib/smartImport/parseFile.ts` | `parseFileToTable(file): Promise<{rows: string[][], sheetNames?}>`. CSV/TSV : parser maison avec gestion des guillemets + détection de délimiteur. Excel : `const XLSX = await import('xlsx')` (lazy → chunk séparé), `sheet_to_json(ws, {header:1, defval:'', raw:false})` ; exposer les feuilles si classeur multi-feuilles |
| `src/lib/smartImport/applyMapping.ts` | `applyMapping(table, mapping, sections) → {entries, errors, skipped}` — pure, réutilise `parseAmount` de `src/lib/csv.ts` ; valide le mapping (indices dans les bornes, clés de rubrique existantes, fallback) |
| `src/lib/smartImport/applyMapping.test.ts` + tests parseFile CSV | Tests vitest (déjà installé, `npm test`) : CSV quoté, montants FR, headerRows, skip/ignore, valueMap/fallback, montant unique, signConvention, mapping invalide |
| `convex/importMapping.ts` | Action `analyzeImport({sample, sections, answers, round})` — squelette d'`assistant.ts` (auth `getAuthUserId`, env `DEEPSEEK_API_KEY`/`DEEPSEEK_MODEL`/`DEEPSEEK_BASE_URL`, fetch `POST {base}/chat/completions`), `response_format: {type:'json_object'}` (le mot « JSON » doit figurer dans le prompt), parsing défensif copié de `vision.ts` (fences, extraction `{...}`), validation structurelle avant retour, et règle : si `round >= 3` → mapping obligatoire (meilleure hypothèse) |
| `src/components/SmartImportDialog.tsx` | Wizard, props identiques à l'existant `{monthId, monthLabel, onClose}` ; conventions visuelles maison (overlay `fixed inset-0 z-50 bg-black/40`, `app-card`, `app-btn*`, `app-input`) |

### À modifier
- `package.json` : ajouter `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"` (le paquet npm `xlsx` est figé à 0.18.5 avec 2 CVE ; le tarball CDN officiel SheetJS est la version corrigée ; seul SheetJS lit aussi le `.xls` legacy) puis `npm install`.
- `src/components/MonthView.tsx` : ligne 31 importer `SmartImportDialog` à la place d'`ImportDialog` ; remplacer le rendu ligne ~308 ; libellé bouton « Importer un fichier ». Le bouton reste conditionné par `canEdit` (déjà le cas).

### À supprimer / élaguer
- `src/components/ImportDialog.tsx` : supprimé (seul consommateur de `parseBudgetCsv`).
- `src/lib/csv.ts` : garder `parseAmount`, `SectionRef`, `ParsedEntry`, `ParseResult` ; supprimer `parseBudgetCsv`, `normalizeSection`, `SECTION_ALIASES` (code mort).

## Déroulé UX du wizard

Machine à états `step: 'file' | 'analyzing' | 'questions' | 'preview' | 'importing'` :

1. **Fichier** — zone de dépôt + input `accept=".csv,.tsv,.txt,.xls,.xlsx"`. Sélecteur de feuille si multi-feuilles (local, sans IA). Mini-aperçu brut (5 lignes). Bouton « Analyser avec l'IA ». Refus > ~10 Mo.
2. **Analyse** — spinner ; appel `analyzeImport` (échantillon = 20 premières lignes non vides, rubriques de `useSections()`, `answers: []`, `round: 1`).
3. **Questions** (0 à 3 tours) — radios par question + champ texte si `allowFreeText` ; compteur « tour X/3 » ; re-appel avec answers cumulées. Garde client au-delà de 3 tours → erreur + repli manuel.
4. **Aperçu** — `applyMapping` sur tout le fichier en local. Bandeau confiance/notes IA ; tableau éditable (pattern PhotoImportDialog l.388-449 : select rubrique, inputs libellé/prévu/réel, supprimer ligne, ajouter ligne) ; erreurs dans le bloc ambre ; checkbox « Remplacer toutes les lignes existantes du mois » ; bouton « Reconfigurer » (retour questions, tour 1, avec note libre de l'utilisateur). Si > 200 lignes : afficher 200 + « +N lignes » ; si > 500 lignes : avertissement + confirmation avant import.
5. **Import** — `importEntries({monthId, entries, replace})` puis `onClose()` (même code que l'actuel ImportDialog l.48-57).

**Repli manuel** (robustesse sans IA / 3 tours infructueux / clé absente) : panneau de mapping minimal (selects colonne libellé / prévu / réel / rubrique fixe) qui produit le même `ImportMapping` → réutilise tout le pipeline aval.

## Cas limites

- **Sans en-têtes** : `headerRows: 0` ; si ambigu l'IA pose la question (Oui/Non avec la ligne citée).
- **Une seule colonne montant** : question « Prévu / Réel / Les deux » → `singleAmountTarget` (convention existante : réel absent → réel = prévu).
- **Sections inconnues** : V1 mappe **uniquement vers les rubriques existantes** (l'action n'expose que ces clés, `valueMap`/`fallback` validés serveur ET client). L'IA pose la question « Vers quelle rubrique vont les lignes “X” ? ». Création de rubrique à la volée = extension V2 hors périmètre.
- **Montants invalides** : `parseAmount` → 0 + erreur listée « Ligne N : montant illisible », ligne conservée et corrigeable dans l'aperçu. Libellé vide → ligne exclue + erreur.
- **Totaux/titres intercalés** : `skipRowIndexes` (vus dans l'échantillon) + `ignoreLabelContains` (filtre déterministe sur tout le fichier). Lignes vides toujours ignorées.
- **Relevés signés** : `negative-is-expense` → valeur absolue (revenu/dépense porté par la rubrique).
- **IA indisponible** : `{status:'error'}` propre (pattern assistant.ts) → repli manuel.
- **.xls corrompu/protégé** : try/catch dans `parseFileToTable` → « Fichier illisible » à l'étape 1.

## Étapes d'implémentation

1. Dépendance `xlsx` (tarball CDN SheetJS) + `npm install`.
2. `src/lib/smartImport/types.ts` (protocole complet).
3. `src/lib/smartImport/parseFile.ts` (CSV quoté natif + branche Excel lazy).
4. `src/lib/smartImport/applyMapping.ts` (pure, réutilise `parseAmount`).
5. Tests vitest sur 3 et 4.
6. `convex/importMapping.ts` (action DeepSeek ; `npx convex dev` pour régénérer l'API).
7. `src/components/SmartImportDialog.tsx` (wizard complet).
8. `MonthView.tsx` : branchement, libellé du bouton.
9. Nettoyage : supprimer `ImportDialog.tsx`, élaguer `csv.ts`.
10. Itération du prompt système avec des fichiers réels (étape empirique, 2-3 allers-retours).

## Vérification

1. `npm test` (vitest) — parseFile CSV + applyMapping.
2. `npx convex dev` (vérifier `npx convex env get DEEPSEEK_API_KEY`) + `npm run dev` (port 3000).
3. Jeux d'essai (hors repo, via LibreOffice) : `budget.xlsx` propre (Poste|Prévu|Réel|Catégorie, montants « 1 234,56 € », ligne TOTAL) ; `releve.csv` bancaire (Date;Libellé;Montant signé → questions montant unique + rubrique, negative-is-expense) ; `legacy.xls` BIFF ; fichier sans en-tête ; multi-feuilles ; fichier vide.
4. Parcours e2e manuel : page du mois → import → questions → corriger/supprimer une ligne dans l'aperçu → importer avec puis sans « remplacer » → vérifier lignes, ordre par section, SummaryCards ; vérifier bouton masqué en lecture seule (`canEdit=false`).
5. Robustesse : sans `DEEPSEEK_API_KEY` → message propre + repli manuel ; `npx convex logs` → seul l'échantillon (≤20 lignes) part vers l'API.
6. `npm run build` → vérifier que `xlsx` est dans un chunk séparé (sortie Vite).
