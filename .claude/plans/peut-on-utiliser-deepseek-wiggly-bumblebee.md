# Plan — Permettre la création de nouveaux mois (multi-année)

## Contexte

L'application est aujourd'hui **figée sur l'année 2025** : impossible de créer ou
consulter des mois d'une autre année (2026, 2027…). Or « aujourd'hui » est en
2026, donc les utilisateurs ne peuvent pas saisir leur budget courant.

Le **backend est déjà 100% multi-année** — `ensureMonth`, `getMonth`,
`listMonths` (`convex/budget.ts`) et la route `/mois/$year/$month`
(`src/routes/mois.$year.$month.tsx`) acceptent n'importe quel `(year, month)`.
Le blocage est **uniquement frontend**, à 3 endroits qui codent l'année en dur ou
bornent la navigation.

**Décisions retenues** :
- Création via **sélecteur d'année + clic sur un mois** (un clic sur une carte de
  mois le crée directement) ; pas de boîte de dialogue dédiée.
- **Navigation préc./suiv. qui franchit les années** (déc 2025 → jan 2026).
- **Année par défaut = la plus récente où l'utilisateur a des mois**, sinon
  l'année civile en cours.

**Résultat visé** : un utilisateur peut naviguer entre années, créer n'importe
quel mois (passé/futur), et le tableau de bord/la liste s'ouvrent sur l'année
pertinente.

---

## Approche (réutilise l'existant, aucun changement backend)

Logique commune (dans `/mois` et le dashboard) pour l'année sélectionnée :
```ts
const months = useQuery(api.budget.listMonths)
const currentYear = new Date().getFullYear()            // OK en composant navigateur
const defaultYear = months?.length ? Math.max(...months.map(m => m.year)) : currentYear
const [picked, setPicked] = useState<number | null>(null)
const year = picked ?? defaultYear                       // suit le défaut tant que non choisi
```
Un petit composant présentational **`YearSelector`** (◀ {year} ▶) factorise le
sélecteur, réutilisé par les deux pages.

---

## Fichiers à modifier

### 1. Créer `src/components/YearSelector.tsx` (nouveau, ~30 lignes)
Composant `{ year: number, onChange: (y:number)=>void }` : deux boutons
`ChevronLeft`/`ChevronRight` (lucide) entourant l'année, style `app-btn-ghost`.
`onChange(year-1)` / `onChange(year+1)`.

### 2. `src/components/MonthView.tsx` — navigation inter-années
Lignes ~60-62 : remplacer les bornes par un rollover d'année.
```ts
const prev = month > 1 ? { year, month: month - 1 } : { year: year - 1, month: 12 }
const next = month < 12 ? { year, month: month + 1 } : { year: year + 1, month: 1 }
```
`NavArrow` a désormais toujours une cible (on peut simplifier/retirer la branche
`null`). Les flèches **naviguent** seulement ; un mois inexistant affiche le
bouton « Créer ce mois » existant (pas d'auto-création par simple navigation —
évite de créer des mois vides en masse). Inchangé : `ensureMonth`, « Créer ce mois ».

### 3. `src/routes/mois.index.tsx` — sélecteur d'année + clic-pour-créer
- Remplacer `const YEAR = 2025` (ligne 16) par la logique `year` ci-dessus +
  `<YearSelector year onChange={setPicked} />` en tête. Titre « Mes mois — {year} ».
- Le `filter((m) => m.year === YEAR)` (ligne ~24) utilise `year`.
- **Cartes de mois** : remplacer le `<Link>` par un `<button>` avec `onClick`
  qui **crée puis navigue** (uniforme, idempotent) :
  ```ts
  const ensureMonth = useMutation(api.budget.ensureMonth)
  const navigate = useNavigate()
  async function openMonth(m: number) {
    await ensureMonth({ year, month: m })            // idempotent : crée si absent
    navigate({ to: '/mois/$year/$month', params: { year: String(year), month: String(m) } })
  }
  ```
  Garder le même style de carte + le badge « Vide » / « Excédent/Déficit ».

### 4. `src/routes/index.tsx` (dashboard) — sélecteur d'année
- Remplacer `const YEAR = 2025` (ligne 44) par la logique `year` +
  `<YearSelector>` près du titre (à côté du bouton « Exporter PDF »).
- Tous les agrégats/graphiques (`yearMonths`, `byMonth`, `monthlyData`,
  `ExpenseBreakdown`, export PDF) utilisent `year` au lieu de `YEAR`.
- `EmptyState` (base totalement vide) inchangé ; un **année sans données** affiche
  simplement des graphiques vides, ce qui est attendu.

---

## Points d'attention
- `new Date().getFullYear()` : utilisé uniquement côté composant navigateur (pas
  dans une fonction Convex) → autorisé.
- Le `year` suit `defaultYear` pendant le chargement de `listMonths`, puis l'année
  choisie dès que l'utilisateur clique ◀/▶ (`picked`).
- `ensureMonth` étant idempotent, cliquer une carte déjà remplie ne duplique rien.
- Aucune migration ni changement de schéma/backend.

## Vérification (bout en bout)
1. `npm run build` doit passer (client + SSR).
2. App lancée, connecté : sur **/mois**, utiliser ◀/▶ pour aller en **2026**
   (grille vide), cliquer un mois → il est créé et on arrive sur sa vue.
3. Dans la vue mensuelle, vérifier que **déc → jan** change d'année (déc 2025 →
   jan 2026) et **jan → déc** recule d'une année.
4. Ajouter une ligne dans un mois 2026 → revenir sur **/mois** (2026) : la carte
   passe de « Vide » à un NET ; le **tableau de bord** sur 2026 reflète les chiffres.
5. Vérifier que l'app s'ouvre par défaut sur **2025** tant que seules les données
   2025 existent, puis sur **2026** une fois des mois 2026 créés.
6. Console navigateur sans erreur.

## Récap des changements
- **Créer** : `src/components/YearSelector.tsx`.
- **Modifier** : `src/components/MonthView.tsx` (rollover), `src/routes/mois.index.tsx`
  (sélecteur + clic-créer), `src/routes/index.tsx` (sélecteur + `year`).
- **Inchangé** : tout le backend Convex (`ensureMonth`/`getMonth`/`listMonths`),
  la route `/mois/$year/$month`, le seed.
