# Plan — « Importer par photo » (analyse de document par vision)

## Contexte

L'utilisateur veut prendre une **photo d'un document** (fiche de paie, facture,
ticket, relevé) et que l'image soit **analysée automatiquement** pour ajouter
les lignes correspondantes dans le budget. Il demandait d'utiliser **DeepSeek V4**.

**Constat (sources, juin 2026)** : DeepSeek V4 (`deepseek-v4-pro` / `-flash`,
API hébergée, compatibles OpenAI **et** Anthropic, 1M ctx) est **texte uniquement
— pas d'entrée image**. Les modèles vision DeepSeek (VL2, OCR/OCR-2) sont
open-source et ne sont **pas** sur l'API officielle (seul Replicate héberge VL2).
→ L'étape « voir l'image » nécessite un modèle **vision**.

**Décisions utilisateur** :
- Moteur vision = **Claude (Anthropic)** (meilleure extraction structurée).
- **Aperçu éditable** des lignes détectées avant ajout (l'OCR n'est jamais parfait).

L'architecture est **indépendante du fournisseur** : `base_url`/`model` en variables
d'env permettent de basculer plus tard vers l'endpoint compatible‑Anthropic de
DeepSeek (ou OpenAI/Gemini) sans réécrire le flux.

**Résultat visé** : un bouton « Importer par photo » dans la vue mensuelle →
upload/caméra → analyse Claude → tableau éditable (section/libellé/montant) →
import via la mutation existante `importEntries`.

---

## Approche (réutilise un maximum l'existant)

Flux : **photo (client, compressée) → action Convex `vision.ts` (fetch Anthropic)
→ `{rows, errors}` → tableau éditable → `api.budget.importEntries`**.

On réutilise :
- `convex/budget.ts` → mutation **`importEntries`** (contrat :
  `{ monthId, replace?, entries: Array<{section,label,budget,real}> }`, `sectionValidator`
  = `'income'|'fixed'|'variable'|'credit'|'saving'`). **Aucune modification.**
- `src/lib/budget.ts` → `SECTIONS`, `SECTION_LABELS`, type `Section` (pour le `<select>`
  et la validation).
- `src/components/ImportDialog.tsx` → **modèle UX** de la modale (structure
  `fixed inset-0 z-50 bg-black/40`, `app-card`, en-tête `X`, pied `app-btn-*`,
  checkbox « remplacer », bouton « Importer N lignes »). Ici l'aperçu est **éditable**.
- `src/components/MonthView.tsx` → barre d'actions + pattern `importOpen` (état +
  dialogue monté en bas).

---

## Fichiers

### 1. Créer `convex/vision.ts` — action de vision (~90 lignes)

- `export const extractEntriesFromImage = action({ args: { imageBase64: v.string(), mimeType: v.string() }, handler })`.
- **Pas de `"use node"`** : le runtime V8 par défaut de Convex fournit `fetch` (appels
  sortants OK). On n'utilise pas le SDK Anthropic (fetch brut → pas de bundling Node).
- Garde-fou auth léger : `getAuthUserId(ctx)` ; throw si `null` (évite un proxy vision
  ouvert aux anonymes).
- Lit `process.env` : `ANTHROPIC_API_KEY` (obligatoire ; si absent → retourne
  `{rows:[], errors:["Clé ANTHROPIC_API_KEY manquante…"]}`), `ANTHROPIC_MODEL`
  (défaut **`claude-sonnet-4-6`** — bon compromis vision/coût/latence), `ANTHROPIC_BASE_URL`
  (défaut `https://api.anthropic.com`).
- Requête `POST {baseUrl}/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`,
  `content-type: application/json`. `messages[0].content` = `[{type:'image', source:{type:'base64', media_type:mimeType, data:imageBase64}}, {type:'text', text:'…'}]`.
- **Prompt système** : impose une **sortie JSON pure** = tableau d'objets
  `{section, label, amount}` avec `section` ∈ les 5 clés exactes, et règles de
  classification (paie/primes→`income` ; loyer/abonnements/assurances/énergie→`fixed` ;
  achats ponctuels/tickets/courses→`variable` ; prêts/crédits→`credit` ;
  virements épargne→`saving` ; fiche de paie → NET À PAYER en une ligne `income`).
- **Parsing tolérant (approche principale)** : retirer d'éventuelles fences ```json,
  `JSON.parse`, accepter un tableau **ou** `{entries:[…]}`, valider chaque item
  (`section` ∈ enum, `label` non vide, `amount` fini), mapper vers
  `{section, label, budget: amount, real: amount}`. Items invalides → poussés dans
  `errors`. (Le schéma structuré natif d'Anthropic = amélioration optionnelle ultérieure ;
  le parsing par prompt marche aussi sur les endpoints compatibles DeepSeek/OpenAI.)
- Remonter les erreurs HTTP (`!resp.ok`) dans `errors` au lieu de throw.
- Retour : `{ rows: Array<{section,label,budget,real}>, errors: string[] }`.

### 2. Créer `src/components/PhotoImportDialog.tsx` — modale + aperçu éditable (~200 lignes)

- Props comme `ImportDialog` : `{ monthId: Id<'months'>, monthLabel: string, onClose }`.
- Hooks : `useAction(api.vision.extractEntriesFromImage)` **et**
  `useMutation(api.budget.importEntries)` (les deux depuis `convex/react`).
- Upload : `<input type="file" accept="image/*" capture="environment" />` (caméra arrière
  sur mobile) + aperçu `<img>`.
- **Compression obligatoire avant envoi** (helper `downscaleImage`, inline ou
  `src/lib/image.ts`) : canvas, max 1600 px sur le grand côté, ré-encodage **JPEG q≈0.8**,
  on extrait `base64` (sans le préfixe `data:`) + `mimeType:'image/jpeg'`. Évite la limite
  d'arguments Convex (~Mo), réduit coût/latence, gère le HEIC iPhone.
- Bouton « Analyser » → appelle l'action, remplit `rows` (état éditable, `amount` en string
  pour une saisie fluide) + `errors` ; spinner `Loader2 animate-spin` pendant l'appel.
- **Tableau éditable** : par ligne `<select>` section (`SECTIONS`/`SECTION_LABELS`),
  `<input>` libellé, `<input type="number">` montant, bouton supprimer ; bouton « + ajouter
  une ligne ». Helpers `updateRow/removeRow/addRow` sur le state.
- Checkbox « remplacer les lignes existantes » + bouton « Importer N ligne(s) » →
  map `rows` → `{section, label, budget:Number(amount)||0, real:Number(amount)||0}`,
  filtre libellés vides, `await importEntries({ monthId, entries, replace })`, `onClose()`.

### 3. Modifier `src/components/MonthView.tsx` (4 insertions)

- Importer l'icône `Camera` (lucide) + `PhotoImportDialog`.
- État `const [photoOpen, setPhotoOpen] = useState(false)` (à côté de `importOpen`).
- Bouton dans la barre d'actions, après « Importer CSV » :
  `<button className="app-btn-ghost" onClick={() => setPhotoOpen(true)}><Camera/> Importer par photo</button>`.
- Montage du dialogue à côté de `{importOpen && <ImportDialog…/>}`.

### 4. Config & doc

- Secrets (l'utilisateur exécute) :
  `npx convex env set ANTHROPIC_API_KEY sk-ant-…` (+ optionnels `ANTHROPIC_MODEL`,
  `ANTHROPIC_BASE_URL`).
- ⚠️ **Jamais en `VITE_*`** : la clé reste côté Convex (lue via `process.env` dans
  l'action serveur), pour ne pas l'exposer dans le bundle client.
- `README.md` : section « Import par photo (Claude vision) » (fonction, variables d'env,
  note de coût ~0,01–0,02 $/photo, modèle par défaut). `.env.example` : commentaire
  rappelant que `ANTHROPIC_API_KEY` est une **variable Convex**, pas Vite.

---

## Pièges (déjà intégrés au plan)

1. **Taille image** → compression canvas obligatoire avant envoi (limite d'args Convex).
2. **`useAction` (effets externes) ≠ `useMutation` (écriture DB)** — action ne peut pas
   écrire, mutation ne peut pas `fetch`.
3. **Pas de `"use node"`** — fetch dispo dans le runtime V8 par défaut.
4. **Caméra réelle** : `capture` n'ouvre la caméra qu'en contexte sécurisé (`localhost`/
   `https`). Depuis un vrai téléphone sur le LAN en `http://`, pas d'accès caméra (le picker
   fichier marche quand même) → suggérer un tunnel HTTPS (cloudflared/ngrok) pour tester au mobile.
5. **`media_type`** : Anthropic accepte jpeg/png/webp/gif ; on ré-encode toujours en JPEG.
6. **Clé manquante / erreur HTTP** : remontées proprement dans `errors` (message visible
   dans l'aperçu), pas de crash.

---

## Vérification (bout en bout)

1. `npx convex env set ANTHROPIC_API_KEY sk-ant-…` puis laisser `npx convex dev` (watch)
   recompiler — vérifier que `convex/_generated/api.d.ts` expose `vision`.
2. `npm run build` doit passer (client + SSR).
3. App lancée (`npm run dev`, http://localhost:3000), connecté : aller sur un mois,
   cliquer « Importer par photo ».
4. Charger une **image de test** d'un ticket/fiche de paie (depuis le disque) → « Analyser »
   → vérifier que des lignes apparaissent dans le tableau éditable avec des sections plausibles.
5. Éditer une ligne (section/montant), supprimer/ajouter une ligne, cliquer « Importer » →
   vérifier dans la vue du mois que les lignes sont ajoutées et que le résumé se met à jour.
6. Vérifier la console navigateur (aucune erreur) et les logs Convex (`/tmp/convex-dev.log`)
   pour confirmer l'appel à l'API vision. Tester le cas « clé absente » → message d'erreur clair.

## Récap des changements
- **Créer** : `convex/vision.ts`, `src/components/PhotoImportDialog.tsx` (+ helper
  `downscaleImage`, éventuellement `src/lib/image.ts`).
- **Modifier** : `src/components/MonthView.tsx`, `README.md`, `.env.example`.
- **Hors code** : `npx convex env set ANTHROPIC_API_KEY …`.
- **Inchangé** : `convex/budget.ts` (`importEntries` réutilisé tel quel), `src/lib/budget.ts`.
