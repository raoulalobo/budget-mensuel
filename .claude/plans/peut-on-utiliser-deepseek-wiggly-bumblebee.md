# Plan — Modèle « reçus » partagés (photo = un reçu, plusieurs lignes)

## Contexte

La fonctionnalité « détail + photo + note » (non encore commitée) lie la photo
**à chaque ligne** via `entries.imageStorageId`. Un ticket à plusieurs articles
produit plusieurs lignes qui **partagent le même fichier** (stocké une seule fois,
référencé N fois). Deux vrais défauts de ce modèle :
- **Suppression cassante** : supprimer une ligne efface le fichier partagé → les
  autres lignes du même ticket perdent leur image (référence morte).
- **Remplacement** d'une photo sur une ligne n'affecte pas ses sœurs.
- La photo appartient logiquement au **ticket**, pas à chaque ligne.

**Décision** : introduire une table **`receipts`** (un reçu = un fichier stocké une
fois). Chaque ligne référence un `receiptId`. **Suppression par comptage de
références** : le fichier n'est effacé que lorsque plus aucune ligne ne le référence.
La `note` reste **par ligne** (chaque article peut avoir sa note).

Comme la feature est seulement en local (pas commitée/déployée), on refactore le
modèle proprement avant de figer.

---

## Fichiers à modifier

### 1. `convex/schema.ts`
- Nouvelle table :
  ```ts
  receipts: defineTable({
    userId: v.id('users'),
    storageId: v.id('_storage'),
  }).index('by_user', ['userId']),
  ```
- `entries` : **remplacer** `imageStorageId` par `receiptId: v.optional(v.id('receipts'))`
  (garder `note`). Ajouter un index `.index('by_receipt', ['receiptId'])` pour le
  comptage de références.

### 2. `convex/budget.ts`
- **`generateUploadUrl`** : inchangé.
- **`createReceipt`** (nouvelle mutation) : `requireUser` + `ctx.db.insert('receipts',
  { userId, storageId })` → renvoie le `receiptId`. (Le client : upload via
  `generateUploadUrl` → `storageId` → `createReceipt` → `receiptId`.)
- **Helper `maybeDeleteReceipt(ctx, receiptId)`** : si **aucune** ligne ne référence
  ce reçu (`entries` via index `by_receipt`, `.first()` === null), supprimer le
  fichier (`ctx.storage.delete(receipt.storageId)`) puis le doc `receipts`.
  (Vérifier `receipt.userId === userId`.)
- **`importEntries`** : dans le `v.object` des entries, remplacer `imageStorageId`
  par `receiptId: v.optional(v.id('receipts'))` ; l'insérer.
- **`updateEntry`** : remplacer `imageStorageId` par `receiptId: v.optional(v.id('receipts'))`.
  Au remplacement (ancien `receiptId` ≠ nouveau), après le patch, appeler
  `maybeDeleteReceipt(oldReceiptId)` (et **non** `storage.delete` direct).
- **`removeEntry`** : mémoriser `entry.receiptId`, supprimer la ligne, puis
  `maybeDeleteReceipt(receiptId)` (le comptage exclut la ligne déjà supprimée).
- **`entryPhotoUrl`** : résoudre `entry.receiptId` → `receipts.get` → `storage.getUrl(receipt.storageId)`.

### 3. `src/components/PhotoImportDialog.tsx`
- `handleImport` : pour chaque `seq` distinct conservé, **upload une fois**
  (`uploadImageDataUrl`) → `createReceipt({ storageId })` → `receiptId` ;
  `Map<seq, Id<'receipts'>>` ; chaque entrée reçoit `receiptId` (au lieu de
  `imageStorageId`). Ajouter `const createReceipt = useMutation(api.budget.createReceipt)`.

### 4. `src/components/EntryDetailDialog.tsx`
- `DetailEntry` : `receiptId?: Id<'receipts'>` (au lieu de `imageStorageId`).
- `handleAttach` : upload → `createReceipt({ storageId })` → `updateEntry({ entryId,
  receiptId })`. Ajouter `useMutation(api.budget.createReceipt)`.
- Le reste (note, `entryPhotoUrl` par `entryId`, analyse IA, indicateurs) inchangé.

### 5. `src/components/MonthView.tsx`
- Type local `Entry` : `receiptId?: Id<'receipts'>` (au lieu de `imageStorageId`).
- Indicateur 📎 `Paperclip` : condition `entry.receiptId` (au lieu de `imageStorageId`).

### 6. `src/lib/upload.ts`
- Inchangé (renvoie toujours un `storageId`). Le passage `storageId → receiptId`
  se fait dans les composants via `createReceipt`.

---

## Points d'attention
- **Comptage de références** : l'index `by_receipt` rend la vérif efficace.
  Le fichier n'est supprimé qu'au dernier déréférencement → plus de référence morte.
- **Pas d'orphelins en flux normal** : `createReceipt` n'est appelé qu'à
  l'import confirmé (lignes conservées) ou à l'attache (immédiatement liée à la ligne).
- **`note` reste par ligne** (inchangé).
- **Ownership** : `createReceipt`/`maybeDeleteReceipt`/`entryPhotoUrl` vérifient
  l'utilisateur.
- **Local uniquement** : le schéma local a déjà `imageStorageId` (données de test) ;
  le changement de champ est non bloquant (les anciennes lignes de test perdront
  juste leur lien photo — sans gravité en local). **Prod** n'a pas encore ce schéma.
- **Déploiement** : schéma + fonctions poussés par le build Vercel (`convex deploy`).

## Vérification (bout en bout)
1. `npm run build` OK ; `convex dev` recompile (table `receipts`, index, fonctions).
2. **Import groupé** d'un ticket à 3 articles → 3 lignes créées, toutes liées au
   **même reçu** (vérifier : 1 seul doc `receipts`, 1 seul fichier). La photo
   s'affiche dans le détail de chacune des 3 lignes.
3. **Suppression d'une** des 3 lignes → les 2 autres **gardent leur photo**
   (le fichier n'est PAS supprimé tant qu'une ligne le référence).
4. Supprimer la **dernière** ligne référençant le reçu → le fichier + doc `receipts`
   sont supprimés (plus d'orphelin).
5. **Attache manuelle** d'une photo sur une ligne (détail) → crée un reçu dédié,
   s'affiche ; **Remplacer** → ancien reçu nettoyé s'il n'est plus référencé.
6. **Analyse IA** depuis le détail : inchangée (montant détecté → appliquer).
7. Console navigateur sans erreur.

## Récap des changements
- **Schéma** : table `receipts` + `entries.receiptId` (remplace `imageStorageId`),
  index `by_receipt`.
- **`convex/budget.ts`** : `createReceipt`, `maybeDeleteReceipt`, et adaptation de
  `importEntries`/`updateEntry`/`removeEntry`/`entryPhotoUrl`.
- **Front** : `PhotoImportDialog`, `EntryDetailDialog`, `MonthView` passent de
  `imageStorageId` à `receiptId` (+ appel `createReceipt`).
- **Inchangé** : `vision.ts`, `src/lib/upload.ts`, `src/lib/speech.ts`, la note par ligne.
