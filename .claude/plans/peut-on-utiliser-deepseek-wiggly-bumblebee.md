# Plan — Modale d'ajout d'une ligne (libellé + montants + note voix + photo)

## Contexte

Aujourd'hui, le bouton « Ajouter » d'une section insère **directement** une ligne
vide (libellé seul, montants à 0) ; pour ajouter une note (vocale) ou une photo,
il faut ensuite éditer la ligne et ouvrir son détail. C'est laborieux.

**Objectif** : le bouton « Ajouter » ouvre une **modale d'ajout complète** où l'on
saisit en une fois : libellé, prévu, réel, **note (clavier ou dictée vocale)** et
**photo justificative** (avec analyse IA pour pré-remplir le montant). L'insertion
directe en ligne est supprimée.

Tout l'outillage existe déjà : `useSpeechToText` (`src/lib/speech.ts`),
`downscaleImage` (`src/lib/image.ts`), `uploadImageDataUrl` (`src/lib/upload.ts`),
mutations `createReceipt`/`generateUploadUrl` et action `extractEntriesFromImage`.

---

## Fichiers à modifier / créer

### 1. `convex/budget.ts` — étendre `addEntry`
Ajouter deux args optionnels et les insérer :
```ts
note: v.optional(v.string()),
receiptId: v.optional(v.id('receipts')),
```
(Insérer `note`/`receiptId` dans le `ctx.db.insert('entries', {...})`.)

### 2. `src/components/AddEntryDialog.tsx` — nouvelle modale (création)
Props `{ monthId, section, onClose }`. Même pattern modale que `EntryDetailDialog`
(overlay `bg-black/40`, `app-card`, en-tête badge section + X, pied [Annuler]/[Ajouter]).
État **local** (rien n'est créé avant validation) :
- `label`, `budget` (string), `real` (string).
- `note` + bouton micro (`useSpeechToText`, masqué si non supporté) qui ajoute la
  transcription.
- **Photo** : à l'attache, `downscaleImage(file)` → garder localement
  `{ dataUrl, base64, mime }` (aperçu via `dataUrl`). **Pas d'upload immédiat**
  (évite les orphelins si on annule). Bouton « Analyser » : `extractEntriesFromImage`
  sur `base64` → total détecté → bouton « Appliquer » remplit le champ Réel.
- **Valider « Ajouter »** : si une photo est présente,
  `uploadImageDataUrl(dataUrl, mime, generateUploadUrl)` → `createReceipt({storageId})`
  → `receiptId` ; puis `addEntry({ monthId, section, label, budget:Number||0,
  real:Number||0, note: note||undefined, receiptId })` ; `onClose()`.
  Désactivé si libellé vide.

Hooks : `useMutation(api.budget.addEntry / generateUploadUrl / createReceipt)`,
`useAction(api.vision.extractEntriesFromImage)`. Réutilise `SECTION_LABELS`,
`SECTION_COLORS`, `formatEUR`.

### 3. `src/components/MonthView.tsx` — remplacer le formulaire inline
Dans `SectionCard` :
- Supprimer l'état `newLabel`, `handleAdd` et le `<form>` inline (input + Ajouter).
  (Le `useMutation(addEntry)` peut être retiré de SectionCard : il vit dans la modale.)
- Mettre un **bouton** « + Ajouter une ligne » (pleine largeur, en bas de la carte)
  qui ouvre la modale : `const [addOpen, setAddOpen] = useState(false)`.
- Monter `{addOpen && <AddEntryDialog monthId={monthId} section={section} onClose=... />}`.

---

## Points d'attention
- **Pas d'orphelins** : l'upload + `createReceipt` ne se font qu'à la validation
  (si on annule après avoir choisi une photo, rien n'est stocké).
- **Analyse IA** : utilise le `base64` local (photo fraîche), pas besoin de stocker
  avant d'analyser ; gère le cas « clé API absente » (déjà renvoyé par l'action).
- **Note par ligne** (inchangé) ; dictée via Web Speech (contexte sécurisé requis).
- `addEntry` reste idempotent côté `order` (calcul existant inchangé).
- `EntryDetailDialog` (édition d'une ligne existante) **inchangé**.

## Vérification (bout en bout)
1. `npm run build` OK ; `convex dev` recompile (`addEntry` étendu).
2. Dans une section, cliquer « + Ajouter une ligne » → la modale s'ouvre (badge section).
3. Saisir libellé + prévu + réel → « Ajouter » → la ligne apparaît avec les bons montants.
4. Ajouter une **note** (clavier) puis via le **micro** (dictée fr-FR) → après ajout,
   l'indicateur ✎ est présent sur la ligne ; le détail affiche la note.
5. **Photo** : attacher une image, « Analyser » → le Réel se pré-remplit ; « Ajouter »
   → la ligne a l'indicateur 📎 ; le détail affiche la photo (reçu créé).
6. **Annuler** après avoir choisi une photo → aucune ligne créée, aucun fichier stocké.
7. Console navigateur sans erreur.

## Récap des changements
- **Backend** : `addEntry` accepte `note` + `receiptId`.
- **Créer** : `src/components/AddEntryDialog.tsx`.
- **Modifier** : `src/components/MonthView.tsx` (remplacer l'ajout inline par un
  bouton + la modale).
- **Inchangé** : `EntryDetailDialog`, `vision.ts`, helpers `upload.ts`/`speech.ts`,
  le modèle `receipts`.
