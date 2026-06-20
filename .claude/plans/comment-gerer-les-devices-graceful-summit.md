# Plan — Date picker soigné (shadcn : Radix Popover + react-day-picker)

## Context

On vient d'ajouter une date optionnelle sur les lignes de budget, saisie via des
`<input type="date">` natifs (4 emplacements). Le rendu natif est disgracieux,
surtout en **dark mode** (aucun `color-scheme` déclaré → widget/icône/pop-up au
thème système) et incohérent d'un navigateur à l'autre.

Objectif : remplacer ces inputs natifs par un **date picker au design soigné**,
identique sur tous navigateurs et en dark mode. Choix validé : **approche shadcn/ui**
(Radix Popover + `react-day-picker`), naturelle ici car le projet est **déjà câblé
shadcn** : tokens CSS `oklch` (`--popover`, `--primary`, `--accent`, `--ring`,
`--radius`), `@theme inline`, util `cn` (`src/lib/utils.ts`), `class-variance-authority`,
et `tw-animate-css` déjà importé (`src/styles.css:5`). Intégration ≈ zéro travail de thème.

## Dépendances à ajouter
`react-day-picker` (v9), `@radix-ui/react-popover` (v1), `date-fns` (locale `fr`).
(Déjà présents : `lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`.)

## Composants à créer

### `src/components/ui/popover.tsx`
Fin wrapper Radix : `Popover`, `PopoverTrigger`, `PopoverContent`. Le `Content`
porte le style thème : `bg-popover text-popover-foreground rounded-md border shadow-md
p-0 outline-none` + animations `data-[state=...]` (classes `tw-animate-css`) + un
**z-index supérieur aux modales** (`z-[60]` : les modales `AddEntryDialog`/
`EntryDetailDialog` sont en `z-50` ; le contenu est portalisé sur `<body>`).

### `src/components/ui/calendar.tsx`
`DayPicker` (react-day-picker v9) configuré :
- `locale={fr}` (date-fns), `weekStartsOn={1}` (lundi), `showOutsideDays`.
- Chevrons via `components` avec `ChevronLeft`/`ChevronRight` de `lucide-react`.
- `classNames` mappés sur les tokens (équivalent du `calendar.tsx` shadcn adapté
  v4/v9) : jour sélectionné `bg-primary text-primary-foreground`, aujourd'hui
  `bg-accent text-accent-foreground`, survol `hover:bg-accent`, jours hors-mois
  `text-muted-foreground opacity-50`, caption/nav lisibles. Tout via `cn`.

### `src/components/DateField.tsx` (champ partagé, l'API consommée par l'app)
Props : `{ value?: string /* ISO YYYY-MM-DD */, onChange: (iso: string) => void,
placeholder?: string, disabled?: boolean, clearable?: boolean, size?: 'default' | 'compact',
className?: string }`.
- **Trigger** : un `<button>` stylé comme `app-input` (taille `default`) ou compact
  (pour les cellules de tableau) ; affiche `formatDate(value)` (helper existant
  `src/lib/budget.ts`) ou le `placeholder` en `text-muted-foreground`, + icône
  `CalendarDays` à droite ; en `clearable` avec valeur, une croix `X` efface
  (`onChange('')`) sans ouvrir le calendrier.
- **Contenu** : `<Calendar mode="single" selected={value ? new Date(value+'T12:00:00') : undefined}
  onSelect={(d) => { onChange(d ? isoFromDate(d) : ''); setOpen(false) }} defaultMonth=…/>`.
- Conversion sûre au fuseau (cohérent avec les helpers existants) : lecture à **midi**,
  écriture via composantes **locales**.

### Helper — `src/lib/budget.ts`
Ajouter `isoFromDate(d: Date): string` (→ `YYYY-MM-DD` à partir de
`getFullYear/getMonth/getDate`, sans `toISOString`/UTC). Réutiliser `formatDate`
pour l'affichage. (`isValidISODate` déjà corrigé pour le fuseau.)

## Câblage (remplacer les 4 `<input type="date">`)
- `src/components/AddEntryDialog.tsx` : `<DateField value={date} onChange={setDate}
  clearable placeholder="Choisir une date" />`.
- `src/components/EntryDetailDialog.tsx` : `<DateField value={date}
  onChange={(v) => { setDate(v); handleSaveDate(v) }} clearable placeholder="Aucune date" />`
  — le bouton « Effacer » manuel est replié dans `clearable` (suppression du bloc).
- `src/components/SmartImportDialog.tsx` et `PhotoImportDialog.tsx` (cellule Date de
  l'aperçu) : `<DateField size="compact" value={row.date}
  onChange={(v) => updateRow(i, { date: v })} clearable />`.

Aucun changement de données : `DateField` émet toujours une chaîne ISO (ou `''`),
exactement ce que consomment déjà les états/mutations.

## Notes / points d'attention
- **SSR (TanStack Start)** : Radix Popover + react-day-picker sont sûrs en SSR
  (contenu portalisé seulement à l'ouverture) ; le trigger rend côté serveur.
- **z-index dans les modales** : le popover doit passer **au-dessus** des modales
  `z-50` → `z-[60]`. Le portail body évite que le clic dans le calendrier ferme la
  modale (overlay séparé), comportement à vérifier en e2e.
- **Layers CSS** (cf. mémoire « piège cascade CSS layers ») : styles via classes
  utilitaires Tailwind ; vérifier le rendu dark mode et qu'aucune règle `a {}`/non-
  layerisée n'écrase le popover.
- **i18n** : `date-fns/locale` `fr` (mois/jours en français, lundi en tête).
- Le `color-scheme` natif devient sans objet (plus d'input natif) ; on peut tout de
  même garder une base saine, mais ce n'est plus le sujet.

## Vérification (e2e, app lancée — cf. mémoire « tester-features-en-vrai »)
1. Démarrer l'app (Convex local 3212/3213 + `npm run dev`).
2. **AddEntryDialog** : ouvrir, cliquer le champ date → popover calendrier **en
   français, lundi en tête**, au thème (clair) ; choisir un jour → la date formatée
   s'affiche dans le trigger ; la croix efface.
3. **Dark mode** : basculer le thème → calendrier/popup correctement sombres
   (plus de rendu natif système).
4. **EntryDetailDialog** : même picker, sauvegarde au choix, effacement OK ; le
   popover s'affiche au-dessus de la modale.
5. **Imports** (`SmartImportDialog`, `PhotoImportDialog`) : picker **compact** dans
   la cellule, sélection répercutée dans l'aperçu puis à l'import.
6. **Rétrocompat** : lignes sans date → trigger affiche le placeholder ; lignes
   datées existantes → date correcte.
7. `npx tsc --noEmit` (0 erreur sur les fichiers touchés), `npm test`, et un
   `npm run build` (vérifie le bundling SSR des nouvelles libs).
