import { v } from 'convex/values'
import { getAuthUserId } from '@convex-dev/auth/server'
import { action } from './_generated/server'

/**
 * Action Convex d'analyse d'image par vision (Claude / Anthropic).
 *
 * Reçoit une photo d'un document financier (fiche de paie, facture, ticket,
 * relevé) encodée en base64, l'envoie à un modèle vision et renvoie des lignes
 * de budget structurées prêtes à être importées via `budget.importEntries`.
 *
 * IMPORTANT :
 *  - C'est une `action` (et non une mutation/query) car elle fait un appel
 *    réseau externe (`fetch`). Une action ne peut pas écrire en base : c'est le
 *    client qui appellera ensuite `importEntries` après validation par l'utilisateur.
 *  - Pas de directive `"use node"` : le runtime V8 par défaut de Convex fournit
 *    `fetch` et autorise les appels sortants. On utilise l'API REST brute
 *    d'Anthropic (pas le SDK) pour éviter tout bundling Node.
 *  - La clé API vit uniquement côté serveur (`process.env`), jamais en `VITE_*`.
 *
 * Configuration (variables d'env Convex, via `npx convex env set`) :
 *  - ANTHROPIC_API_KEY   (obligatoire)
 *  - ANTHROPIC_MODEL     (optionnel, défaut "claude-sonnet-4-6")
 *  - ANTHROPIC_BASE_URL  (optionnel, défaut "https://api.anthropic.com" — permet de
 *                         basculer vers un endpoint compatible-Anthropic, ex. DeepSeek)
 */

// Les 5 sections de budget acceptées (doit rester aligné avec src/lib/budget.ts).
const SECTION_KEYS = ['income', 'fixed', 'variable', 'credit', 'saving'] as const
type SectionKey = (typeof SECTION_KEYS)[number]

// Une ligne extraite, au format attendu par `budget.importEntries`.
interface ExtractedRow {
  section: SectionKey
  label: string
  budget: number
  real: number
}

// Résumé consolidé du document, pour les flux « ligne unique » (ajout / détail).
//  - label : libellé global du document
//  - total : le « Total » imprimé (sert de montant ; 0 si non lisible)
//  - note  : le détail des articles + contexte (marchand, date, référence)
interface Summary {
  label: string
  total: number
  note: string
}

// Consigne donnée au modèle : extraire des lignes ET un résumé, en JSON pur.
const SYSTEM_PROMPT = `Tu es un assistant qui extrait des informations budgétaires de documents financiers (fiches de paie, factures, tickets de caisse, relevés bancaires).
Tu réponds UNIQUEMENT avec un OBJET JSON, sans aucun texte autour ni bloc de code Markdown.
L'objet a EXACTEMENT ces deux clés :

1) "summary" : un objet résumant TOUT le document, avec :
   - "label" : un libellé court et parlant pour l'ensemble du document, en français
     (ex. "Salaire", "Facture EDF", "Courses Carrefour", "Restaurant Le Bistrot").
     Privilégie le nom du marchand/émetteur ou la nature de la dépense.
   - "total" : le MONTANT TOTAL du document tel qu'IMPRIMÉ (le "Total", "Montant
     total", "Total TTC", "NET À PAYER", "à payer"). Nombre positif (point
     décimal, sans symbole ni espace). Mets 0 si aucun total n'est lisible.
   - "note"  : le DÉTAIL des articles/postes, un par ligne au format
     "Nom de l'article — prix", PUIS le contexte utile (marchand, date, n° de
     référence). S'il n'y a qu'un seul poste ou rien d'utile, mets une note brève
     ou une chaîne vide "". N'invente aucune information absente du document.

2) "entries" : un tableau de lignes détaillées. Chaque élément a EXACTEMENT :
   - "section" : une des valeurs EXACTES parmi "income","fixed","variable","credit","saving"
   - "label"   : libellé court en français (ex. "Salaire", "Loyer", "Pain")
   - "amount"  : nombre positif en euros (point décimal, sans symbole ni espace)

Règles de classification (pour "section") :
- Salaire, paie, primes, remboursements, revenus → "income"
- Charges récurrentes mensuelles (loyer, électricité, eau, abonnements, assurances, internet, téléphone) → "fixed"
- Achats ponctuels, tickets de caisse, courses, restaurants, carburant, loisirs → "variable"
- Prêts, crédits, mensualités d'emprunt → "credit"
- Virements vers épargne, livret, PEL, placements → "saving"

Cas particuliers (pour "entries") :
- Fiche de paie : retourne le NET À PAYER comme une seule ligne "income".
- Ticket de caisse / facture avec plusieurs articles : DÉTAILLE chaque article ou
  poste comme une ligne distincte (label = nom de l'article, amount = son prix).
  N'inclus PAS les lignes de récapitulatif : TOTAL, SOUS-TOTAL, TVA/TAXES,
  "à payer", "reçu", "rendu monnaie", "espèces", "carte bancaire" — elles
  feraient double emploi avec les articles.
- Si un même article apparaît en quantité (ex. "2 x 1,50"), une seule ligne avec
  le montant total de cet article (3,00).
- N'invente rien : ne renvoie aucune ligne dont le montant n'est pas lisible.
Si le document ne contient aucune information budgétaire, réponds avec
{"summary":{"label":"","total":0,"note":""},"entries":[]}.`

const USER_TEXT =
  'Analyse ce document. Réponds avec l\'objet JSON {summary, entries} uniquement.'

export const extractEntriesFromImage = action({
  args: {
    // Données base64 PURES de l'image (sans le préfixe "data:...;base64,").
    imageBase64: v.string(),
    // Type MIME de l'image (image/jpeg, image/png, image/webp, image/gif).
    mimeType: v.string(),
  },
  handler: async (
    ctx,
    { imageBase64, mimeType },
  ): Promise<{ rows: ExtractedRow[]; errors: string[]; summary: Summary }> => {
    // Résumé vide par défaut (renvoyé sur tous les chemins d'erreur).
    const emptySummary: Summary = { label: '', total: 0, note: '' }

    // Garde-fou : on n'expose pas un proxy vision gratuit aux non-connectés.
    const userId = await getAuthUserId(ctx)
    if (userId === null) {
      return { rows: [], errors: ['Non authentifié.'], summary: emptySummary }
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return {
        rows: [],
        errors: [
          'Clé ANTHROPIC_API_KEY manquante côté serveur. Configurez-la avec : npx convex env set ANTHROPIC_API_KEY <clé>',
        ],
        summary: emptySummary,
      }
    }
    const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6'
    const baseUrl = process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'

    // Appel de l'API Messages d'Anthropic (REST brut).
    let resp: Response
    try {
      resp = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: mimeType,
                    data: imageBase64,
                  },
                },
                { type: 'text', text: USER_TEXT },
              ],
            },
          ],
        }),
      })
    } catch (e) {
      return {
        rows: [],
        errors: [
          `Impossible de contacter l'API vision : ${e instanceof Error ? e.message : 'erreur réseau'}.`,
        ],
        summary: emptySummary,
      }
    }

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      return {
        rows: [],
        errors: [`Erreur API vision (HTTP ${resp.status}). ${detail.slice(0, 200)}`],
        summary: emptySummary,
      }
    }

    const data = await resp.json()

    // Concatène tous les blocs texte de la réponse Anthropic.
    const raw: string = (data?.content ?? [])
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim()

    // Retire d'éventuelles fences ```json … ``` autour du JSON.
    let jsonText = raw
    const fence = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fence) jsonText = fence[1].trim()

    // Parsing tolérant : on tente le JSON tel quel, et en cas d'échec on extrait
    // le premier bloc objet/tableau (le modèle peut entourer le JSON de texte).
    let parsed: unknown
    function tryParse(s: string): unknown | undefined {
      try {
        return JSON.parse(s)
      } catch {
        return undefined
      }
    }
    parsed = tryParse(jsonText)
    if (parsed === undefined) {
      const block = jsonText.match(/[{[][\s\S]*[}\]]/)
      if (block) parsed = tryParse(block[0])
    }
    if (parsed === undefined) {
      console.error('VISION JSON illisible — réponse brute :', raw.slice(0, 1000))
      return {
        rows: [],
        errors: ['Réponse du modèle illisible (JSON invalide). Réessayez avec une photo plus nette.'],
        summary: emptySummary,
      }
    }

    // Accepte soit un tableau direct (ancien format), soit un objet
    // { summary, entries } (nouveau format).
    const arr: any[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as any)?.entries)
        ? (parsed as any).entries
        : []

    // Résumé consolidé (libellé + total + note), nettoyé, vide par défaut.
    const rawSummary = (parsed as any)?.summary
    const rawTotal = Number(rawSummary?.total)
    const summary: Summary = {
      label:
        typeof rawSummary?.label === 'string' ? rawSummary.label.trim() : '',
      total: Number.isFinite(rawTotal) && rawTotal > 0 ? rawTotal : 0,
      note: typeof rawSummary?.note === 'string' ? rawSummary.note.trim() : '',
    }

    const rows: ExtractedRow[] = []
    const errors: string[] = []

    arr.forEach((item, i) => {
      const section = item?.section
      const label = typeof item?.label === 'string' ? item.label.trim() : ''
      const amount = Number(item?.amount)

      if (!SECTION_KEYS.includes(section)) {
        errors.push(`Ligne ${i + 1} ignorée : section invalide « ${section} ».`)
        return
      }
      if (!label) {
        errors.push(`Ligne ${i + 1} ignorée : libellé vide.`)
        return
      }
      if (!Number.isFinite(amount)) {
        errors.push(`Ligne ${i + 1} ignorée : montant non numérique.`)
        return
      }
      // Le montant lu sert à la fois de "prévu" et de "réel" (ajustable ensuite).
      rows.push({ section, label, budget: amount, real: amount })
    })

    if (rows.length === 0 && errors.length === 0) {
      errors.push("Aucune ligne détectée sur l'image.")
    }

    return { rows, errors, summary }
  },
})
