# Budget mensuel — TanStack Start + Convex

Application de budget personnel reconstruite à partir de la feuille Google Sheets
« Budget mensuel 2025 ». Permet de saisir, mois par mois, ses revenus et dépenses
(fixes, variables, crédits, épargne), de suivre son patrimoine (« Avoir ») et de
visualiser le tout sur un tableau de bord avec graphiques.

## Fonctionnalités

- **Authentification** email + mot de passe (Convex Auth)
- **Vue mensuelle** : sections Revenus / Dépenses fixes / variables / Crédits /
  Épargne, édition inline (prévu vs réel), ajout/suppression de lignes
- **Tableau de bord** annuel : KPIs + graphiques (barres, courbe, anneau)
- **Avoir** : suivi du patrimoine / placements
- **Objectifs d'épargne** : cibles avec barres de progression
- **Import CSV/TSV** dans un mois (coller ou fichier, section auto ou imposée)
- **Import par photo** : prendre/charger une photo d'un document (paie, facture,
  ticket) analysée par un LLM vision (Claude), aperçu éditable puis ajout
- **Duplication** d'un mois vers le suivant (charges récurrentes, réel remis à 0)
- **Export PDF** : bilan d'un mois et bilan annuel (jsPDF)

## Stack technique

- **TanStack Start** (Vite 8, React 19) — full-stack, routing par fichiers
- **Convex** — base de données temps réel + fonctions serveur (déploiement **local**)
- **Convex Auth** — authentification email + mot de passe
- **Tailwind CSS v4** + tokens shadcn — habillage
- **Recharts** — graphiques du tableau de bord

## Démarrage

Deux processus à lancer **en parallèle** (dans deux terminaux) :

```bash
# 1) Backend Convex (régénère les types + sert la base locale sur :3210)
npx convex dev

# 2) Frontend TanStack Start (sur http://localhost:3000)
npm run dev
```

Puis ouvrir http://localhost:3000, créer un compte (email + mot de passe ≥ 8
caractères) et cliquer sur **« Importer les données de démo »** pour charger
Janvier 2025 et le patrimoine.

> Le déploiement Convex est **local et anonyme** (aucun compte cloud requis).
> Sa configuration est enregistrée dans `.env.local` (`CONVEX_DEPLOYMENT`,
> `VITE_CONVEX_URL`). Pour passer plus tard en cloud : `npx convex dev` puis
> suivre l'invite de connexion.

### Import par photo (vision Claude)

L'analyse d'image utilise l'API **Anthropic (Claude)**. Configurez la clé comme
**variable d'environnement Convex** (côté serveur — JAMAIS en `VITE_*`, sinon
elle serait exposée dans le bundle client) :

```bash
npx convex env set ANTHROPIC_API_KEY sk-ant-...
# Optionnels :
npx convex env set ANTHROPIC_MODEL claude-sonnet-4-6        # modèle par défaut
npx convex env set ANTHROPIC_BASE_URL https://api.anthropic.com
```

- Modèle par défaut : `claude-sonnet-4-6` (vision + bon rapport coût/latence).
- Coût indicatif : ~0,01–0,02 $ par photo (l'image est compressée côté client
  avant envoi).
- `ANTHROPIC_BASE_URL` permet de basculer vers un endpoint **compatible
  Anthropic** (ex. DeepSeek) ; ⚠️ DeepSeek V4 est **texte uniquement**, il ne
  fait pas de vision — utilisez un modèle vision pour cette fonction.
- **Caméra mobile** : `capture` n'ouvre l'appareil photo qu'en contexte sécurisé
  (`localhost` ou `https`). Depuis un téléphone sur le réseau local en `http://`,
  utilisez le sélecteur de fichier, ou exposez l'app en HTTPS (tunnel
  cloudflared/ngrok).

## Structure du code

```
convex/                 # Backend Convex
  schema.ts             # Tables : users (auth), months, entries, assets
  budget.ts             # CRUD lignes/mois + résumés + import + duplication
  goals.ts              # CRUD des objectifs d'épargne
  auth.ts               # Convex Auth (provider Password)
  seed.ts               # Données de démonstration fictives (Janvier 2025)
src/
  routes/
    __root.tsx          # Layout + gating d'auth (login si déconnecté)
    index.tsx           # Tableau de bord + graphiques
    mois.index.tsx      # Grille des 12 mois
    mois.$year.$month.tsx  # Vue détaillée d'un mois (CRUD inline)
    avoir.tsx           # Patrimoine / placements
  components/
    AuthForm.tsx        # Connexion / inscription
    AppShell.tsx        # En-tête + navigation
    MonthView.tsx       # Sections éditables d'un mois
    SummaryCards.tsx    # Cartes Revenus / Dépenses / Net
  lib/budget.ts         # Constantes (mois FR, sections), formatage €, calculs
```

## Modèle de données

| Table     | Rôle |
|-----------|------|
| `months`  | Un mois budgétaire `{ userId, year, month }` |
| `entries` | Une ligne `{ section, label, budget, real }` rattachée à un mois |
| `assets`  | Un placement de l'onglet « Avoir » `{ label, amount }` |

Les `section` possibles : `income`, `fixed`, `variable`, `credit`, `saving`.
Chaque ligne a un montant **prévu** (`budget`) et **réel** (`real`), comme dans
le tableur d'origine. Le résumé d'un mois est calculé à la volée :
`Net = Revenus − (Dépenses fixes + variables + crédits + épargne)`.

## Données de démonstration

Le bouton « Importer les données de démo » remplit Janvier 2025 avec des
**chiffres fictifs** (cf. `convex/seed.ts`) afin de présenter l'application avec
un mois rempli. Ils ne correspondent à aucune personne réelle ; remplacez-les
par vos propres données via l'interface.
