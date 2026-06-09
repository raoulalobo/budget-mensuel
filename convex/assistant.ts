import { v } from 'convex/values'
import { getAuthUserId } from '@convex-dev/auth/server'
import { action } from './_generated/server'
import { api } from './_generated/api'

/**
 * Assistant budgétaire conversationnel.
 *
 * L'utilisateur pose des questions en langage naturel sur SES données. L'action
 * récupère un instantané de ses données (`budget.assistantSnapshot`), le met en
 * contexte, puis interroge **DeepSeek** (API compatible OpenAI) avec l'historique
 * de la conversation. C'est une action stateless : le client conserve l'historique
 * et le renvoie à chaque message.
 *
 * Config (variables d'env Convex) : DEEPSEEK_API_KEY (+ DEEPSEEK_MODEL,
 * DEEPSEEK_BASE_URL optionnels) — mêmes que le récap IA.
 */

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

export const ask = action({
  args: {
    messages: v.array(
      v.object({
        role: v.union(v.literal('user'), v.literal('assistant')),
        content: v.string(),
      }),
    ),
  },
  handler: async (
    ctx,
    { messages },
  ): Promise<{ answer: string | null; error: string | null }> => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) return { answer: null, error: 'Non authentifié.' }

    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      return {
        answer: null,
        error:
          'Clé DEEPSEEK_API_KEY manquante côté serveur (npx convex env set DEEPSEEK_API_KEY <clé>).',
      }
    }
    const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat'
    const baseUrl = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'

    const snap = await ctx.runQuery(api.budget.assistantSnapshot, {})
    if (!snap || snap.months.length === 0) {
      return {
        answer: null,
        error: 'Aucune donnée budgétaire à analyser pour le moment.',
      }
    }

    const eur = (n: number) =>
      `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

    // Libellés de rubriques (dynamiques) ; repli sur la clé si inconnu.
    const sectionLabel = (key: string) => snap.sectionLabels[key] ?? key

    // Contexte textuel compact à partir de l'instantané.
    let ctxText = "DONNÉES BUDGÉTAIRES DE L'UTILISATEUR (montants en euros) :\n"
    for (const m of snap.months) {
      ctxText += `\n# ${MONTHS[m.month]} ${m.year} — Revenus ${eur(m.summary.incomeReal)}, Dépenses ${eur(m.summary.expenseReal)}, Net ${eur(m.summary.netReal)}\n`
      for (const e of m.entries) {
        ctxText += `  - [${sectionLabel(e.section)}] ${e.label} : prévu ${eur(e.budget)}, réel ${eur(e.real)}\n`
      }
    }
    if (snap.assets.length > 0) {
      ctxText += `\n# Patrimoine (Avoir)\n`
      for (const a of snap.assets) ctxText += `  - ${a.label} : ${eur(a.amount)}\n`
    }
    if (snap.goals.length > 0) {
      ctxText += `\n# Objectifs d'épargne\n`
      for (const g of snap.goals)
        ctxText += `  - ${g.label} : ${eur(g.current)} / ${eur(g.target)}\n`
    }
    if (snap.recurring.length > 0) {
      ctxText += `\n# Lignes récurrentes\n`
      for (const r of snap.recurring)
        ctxText += `  - [${sectionLabel(r.section)}] ${r.label} : ${eur(r.amount)}\n`
    }

    const system = `Tu es l'assistant budgétaire personnel de l'utilisateur, francophone, bienveillant et concret.
Réponds à ses questions en te basant UNIQUEMENT sur les données ci-dessous. Tu peux calculer des totaux, moyennes, écarts et comparaisons.
Réponds en français, de façon concise et directe, en citant des montants précis (en euros). Utilise un peu de Markdown (gras, listes) si utile.
Pour toute question de classement ou d'agrégat (plus gros/petit poste, total, moyenne, comparaison), passe en revue ATTENTIVEMENT tous les montants concernés (montants RÉELS par défaut) et calcule précisément avant de conclure — ne te fie pas à une impression.
Si une information n'est pas présente dans les données, dis-le clairement et n'invente AUCUN chiffre.

${ctxText}`

    // On limite l'historique envoyé (derniers échanges).
    const history = messages.slice(-12)

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
          temperature: 0.3,
          messages: [{ role: 'system', content: system }, ...history],
        }),
      })
    } catch (e) {
      return {
        answer: null,
        error: `Impossible de contacter l'IA : ${e instanceof Error ? e.message : 'erreur réseau'}.`,
      }
    }

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      return {
        answer: null,
        error: `Erreur IA (HTTP ${resp.status}). ${detail.slice(0, 200)}`,
      }
    }

    const json = await resp.json()
    const answer: string = (json?.choices?.[0]?.message?.content ?? '').trim()
    if (!answer) return { answer: null, error: 'Réponse vide de l’IA.' }
    return { answer, error: null }
  },
})
