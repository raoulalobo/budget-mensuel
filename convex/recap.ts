import { v } from 'convex/values'
import { getAuthUserId } from '@convex-dev/auth/server'
import { action } from './_generated/server'
import { api } from './_generated/api'

/**
 * Récap mensuel par IA : à partir des chiffres réels d'un mois, un LLM texte
 * rédige une courte synthèse + quelques conseils d'économie en français.
 *
 * Utilise **DeepSeek** (API compatible OpenAI) — le récap est purement textuel,
 * donc DeepSeek convient (la vision reste sur Claude). C'est une `action` (appel
 * réseau) ; elle récupère les données via `ctx.runQuery(api.budget.getMonth)`
 * (identité utilisateur propagée).
 *
 * Config (variables d'env Convex, `npx convex env set`) :
 *  - DEEPSEEK_API_KEY  (obligatoire)
 *  - DEEPSEEK_MODEL    (optionnel, défaut "deepseek-chat")
 *  - DEEPSEEK_BASE_URL (optionnel, défaut "https://api.deepseek.com")
 */

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' (simple, sans fuseau). Repli sur l'entrée si autre. */
function frDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

const MONTHS = [
  '',
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
]

const SYSTEM_PROMPT = `Tu es un conseiller budgétaire francophone, bienveillant et concret.
À partir des chiffres d'un mois (les montants sont déjà formatés dans la devise de l'utilisateur, indiquée en tête des données — réutilise cette même devise dans ta réponse), rédige en français :
1. Une courte synthèse (2-3 phrases) de la situation du mois (excédent/déficit, postes notables, écarts prévu/réel).
2. 2 à 4 conseils ACTIONNABLES pour améliorer le budget, en citant des postes/montants précis.
Base-toi UNIQUEMENT sur les chiffres fournis, n'invente aucun montant. Format Markdown court (titres ##, listes à puces). Sois chaleureux mais factuel.`

export const monthlyRecap = action({
  args: { year: v.number(), month: v.number() },
  handler: async (
    ctx,
    { year, month },
  ): Promise<{ text: string | null; error: string | null }> => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) return { text: null, error: 'Non authentifié.' }

    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      return {
        text: null,
        error:
          'Clé DEEPSEEK_API_KEY manquante côté serveur (npx convex env set DEEPSEEK_API_KEY <clé>).',
      }
    }
    const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat'
    const baseUrl = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'

    // Données du mois (propagation de l'identité utilisateur).
    const data = await ctx.runQuery(api.budget.getMonth, { year, month })
    if (!data || data.entries.length === 0) {
      return { text: null, error: 'Aucune donnée pour ce mois.' }
    }

    // Devise de l'espace budget courant (même résolution que l'UI : propriétaire
    // effectif). Les montants sont formatés dans cette devise pour le prompt IA.
    const currency = await ctx.runQuery(api.settings.getCurrency, {})
    // Intl gère les décimales selon la devise (EUR/USD → 2, XAF → 0).
    const money = (n: number) =>
      new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(n)

    const s = data.summary
    let dataText = `Devise des montants : ${currency}\n`
    dataText += `Mois : ${MONTHS[month]} ${year}\n`
    dataText += `Revenus réels : ${money(s.incomeReal)} | Dépenses réelles : ${money(s.expenseReal)} | NET : ${money(s.netReal)} (net prévu : ${money(s.netBudget)})\n`
    // Parcourt les rubriques du mois (dynamiques) dans leur ordre d'affichage.
    for (const section of data.sections) {
      const items = data.entries.filter((e: any) => e.section === section.key)
      if (items.length === 0) continue
      const tb = items.reduce((acc: number, e: any) => acc + e.budget, 0)
      const tr = items.reduce((acc: number, e: any) => acc + e.real, 0)
      dataText += `\n## ${section.label} — prévu ${money(tb)}, réel ${money(tr)}\n`
      for (const e of items) {
        // Préfixe la date de la ligne quand elle existe (ex. "[15/01] ").
        const datePrefix = e.date ? `[${frDate(e.date)}] ` : ''
        dataText += `- ${datePrefix}${e.label} : prévu ${money(e.budget)}, réel ${money(e.real)}\n`
      }
    }

    // DeepSeek : API compatible OpenAI (chat completions).
    let resp: Response
    try {
      resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 800,
          temperature: 0.7,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: dataText },
          ],
        }),
      })
    } catch (e) {
      return {
        text: null,
        error: `Impossible de contacter l'IA : ${e instanceof Error ? e.message : 'erreur réseau'}.`,
      }
    }

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      return { text: null, error: `Erreur IA (HTTP ${resp.status}). ${detail.slice(0, 200)}` }
    }

    const json = await resp.json()
    const text: string = (json?.choices?.[0]?.message?.content ?? '').trim()

    if (!text) return { text: null, error: 'Réponse vide de l’IA.' }
    return { text, error: null }
  },
})
