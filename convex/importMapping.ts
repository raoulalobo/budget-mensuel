import { v } from 'convex/values'
import { getAuthUserId } from '@convex-dev/auth/server'
import { action } from './_generated/server'
import type {
  AnalyzeImportResult,
  ImportMapping,
  ImportQuestion,
  SectionStrategy,
} from '../src/lib/smartImport/types'

/**
 * Agent IA d'analyse de fichier d'import (xls/xlsx/csv).
 *
 * Reçoit un ÉCHANTILLON du fichier (en-têtes + ~20 premières lignes), la liste
 * des rubriques de l'utilisateur et les réponses déjà données, puis interroge
 * **DeepSeek** (API compatible OpenAI, mêmes variables d'env que l'assistant)
 * pour obtenir SOIT des questions structurées à poser à l'utilisateur, SOIT un
 * MAPPING JSON décrivant comment interpréter les colonnes.
 *
 * IMPORTANT :
 *  - C'est une `action` (appel réseau externe) : elle n'écrit RIEN en base.
 *    Le mapping est appliqué côté client (`applyMapping`) puis l'import passe
 *    par la mutation existante `budget.importEntries`.
 *  - Action STATELESS (comme `assistant.ask`) : le client cumule les réponses
 *    des tours précédents et renvoie tout à chaque appel.
 *  - Boucle BORNÉE : à partir du tour `MAX_ROUNDS`, le prompt impose un mapping
 *    (meilleure hypothèse) ; le serveur convertit toute question excédentaire
 *    en erreur — le client a la même garde (défense en profondeur).
 *  - La réponse de l'IA est VALIDÉE structurellement avant d'être renvoyée
 *    (indices numériques, clés de rubrique existantes, fallback présent…).
 *
 * Config (variables d'env Convex) : DEEPSEEK_API_KEY (+ DEEPSEEK_MODEL,
 * DEEPSEEK_BASE_URL optionnels) — mêmes que l'assistant et le récap.
 */

/** Nombre maximal de tours de questions avant mapping obligatoire. */
export const MAX_ROUNDS = 3

/** Construit le prompt système : protocole JSON + rubriques autorisées. */
function buildSystemPrompt(
  sections: Array<{ key: string; label: string; kind: string }>,
  round: number,
): string {
  const sectionList = sections
    .map((s) => `  - "${s.key}" : ${s.label} (${s.kind === 'income' ? 'revenu' : 'dépense'})`)
    .join('\n')

  return `Tu es un agent d'import de données budgétaires. L'utilisateur fournit un fichier tabulaire (extrait ci-après) à importer dans son application de budget. Chaque ligne importée a la forme : { section, label, budget (montant prévu), real (montant réel) }.

Ton travail : déterminer comment mapper les COLONNES du fichier vers ces champs. Si une information est ambiguë, tu poses des questions à CHOIX à l'utilisateur. Quand tu as assez d'informations, tu renvoies le mapping final.

Tu réponds UNIQUEMENT avec un OBJET JSON (aucun texte autour, aucun bloc de code), dans l'un de ces deux formats :

FORMAT 1 — questions (1 à 3 questions maximum par tour) :
{
  "status": "questions",
  "questions": [
    {
      "id": "identifiant_stable",
      "text": "Question en français, claire et courte ?",
      "options": [{ "value": "valeur_machine", "label": "Libellé affiché" }],
      "allowFreeText": false
    }
  ]
}
Les "value" doivent être machine-exploitables : index de colonne en string ("0", "1"…), clé de rubrique, ou mot-clé simple. Cite des exemples du fichier dans les labels pour aider l'utilisateur (ex. "Colonne B — « Montant » (ex. -45,90)").

FORMAT 2 — mapping final :
{
  "status": "mapping",
  "confidence": 0.9,
  "notes": "Brève explication en français de tes choix.",
  "mapping": {
    "headerRows": 1,
    "labelColumn": 0,
    "budgetColumn": 1,
    "realColumn": 2,
    "singleAmountTarget": "both",
    "section": { "type": "fixed", "key": "fixed" },
    "skipRowIndexes": [],
    "ignoreLabelContains": ["total", "sous-total"],
    "signConvention": "absolute"
  }
}

Détail des champs du mapping (index de colonnes 0-based) :
- "headerRows" : nombre de lignes d'en-tête à sauter (0 si aucune).
- "labelColumn" : colonne du libellé de la ligne.
- "budgetColumn" / "realColumn" : colonnes des montants prévu / réel. Mets null si la colonne n'existe pas. S'il n'y a qu'UNE colonne de montant, mets-la dans "realColumn" (ou "budgetColumn") et précise "singleAmountTarget" :
  - "both" : le montant sert de prévu ET de réel (cas le plus courant) ;
  - "budget" : montant prévisionnel uniquement ;
  - "real" : dépense réelle uniquement (prévu = 0).
- "section" : comment affecter la rubrique. UNE de ces trois formes :
  - { "type": "fixed", "key": "<clé>" } : toutes les lignes dans la même rubrique ;
  - { "type": "column", "column": N, "valueMap": { "valeur du fichier": "<clé>" }, "fallback": "<clé>" } : une colonne contient la catégorie ;
  - { "type": "rules", "rules": [{ "column": N, "contains": "texte", "key": "<clé>" }], "fallback": "<clé>" } : règles "contient" (utile pour les relevés bancaires).
- "skipRowIndexes" : index (0-based, dans le fichier) de lignes à ignorer VUES dans l'échantillon (titres intercalés, lignes décoratives).
- "ignoreLabelContains" : fragments (minuscules) — toute ligne dont le libellé les contient est ignorée sur TOUT le fichier (ex. ["total", "tva"]).
- "signConvention" : "negative-is-expense" si les montants sont signés (relevé bancaire), sinon "absolute".

RUBRIQUES AUTORISÉES (seules clés acceptées pour "key", "valueMap", "fallback") :
${sectionList}

Règles :
- N'invente JAMAIS d'autre clé de rubrique. Si une catégorie du fichier ne correspond à rien, demande à l'utilisateur vers quelle rubrique la mapper, ou utilise "fallback".
- Choisis "kind" cohérent : salaires/revenus → rubrique de type revenu.
- L'échantillon est PARTIEL : préfère "ignoreLabelContains" (s'applique partout) à "skipRowIndexes" (lignes précises) pour les totaux récurrents.
- Pose le MINIMUM de questions : si le fichier est clair, renvoie directement le mapping.
- Ne demande RIEN sur le mois/la date cible : l'import vise un mois déjà choisi.${
    round >= MAX_ROUNDS
      ? '\n- DERNIER TOUR : tu DOIS renvoyer le FORMAT 2 (mapping) avec ta meilleure hypothèse, même imparfaite. Aucune question supplémentaire.'
      : ''
  }`
}

/** Tente un JSON.parse sans lever (renvoie undefined en cas d'échec). */
function tryParse(s: string): unknown | undefined {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

/**
 * Valide structurellement la réponse de l'IA et la convertit en
 * `AnalyzeImportResult` sûr. Toute anomalie → `{ status: 'error' }`.
 */
function validateAiResult(
  parsed: any,
  sectionKeys: Set<string>,
): AnalyzeImportResult {
  if (parsed?.status === 'questions') {
    const raw = Array.isArray(parsed.questions) ? parsed.questions : []
    const questions: ImportQuestion[] = []
    for (const q of raw.slice(0, 3)) {
      if (typeof q?.id !== 'string' || typeof q?.text !== 'string') continue
      const options = Array.isArray(q.options)
        ? q.options
            .filter(
              (o: any) => typeof o?.value === 'string' && typeof o?.label === 'string',
            )
            .map((o: any) => ({ value: o.value, label: o.label }))
        : []
      if (options.length === 0 && q.allowFreeText !== true) continue
      questions.push({
        id: q.id,
        text: q.text,
        options,
        allowFreeText: q.allowFreeText === true,
      })
    }
    if (questions.length === 0) {
      return { status: 'error', error: 'Questions illisibles renvoyées par l’IA.' }
    }
    return { status: 'questions', questions }
  }

  if (parsed?.status === 'mapping') {
    const m = parsed.mapping
    const intOrNull = (x: any): number | null =>
      x === null || x === undefined ? null : Number.isInteger(x) ? x : NaN
    const budgetColumn = intOrNull(m?.budgetColumn)
    const realColumn = intOrNull(m?.realColumn)

    // Stratégie de rubrique : on vérifie le type ET que toutes les clés existent.
    let section: SectionStrategy | null = null
    const s = m?.section
    if (s?.type === 'fixed' && sectionKeys.has(s.key)) {
      section = { type: 'fixed', key: s.key }
    } else if (
      s?.type === 'column' &&
      Number.isInteger(s.column) &&
      typeof s.valueMap === 'object' &&
      s.valueMap !== null &&
      Object.values(s.valueMap).every((k) => typeof k === 'string' && sectionKeys.has(k)) &&
      sectionKeys.has(s.fallback)
    ) {
      section = {
        type: 'column',
        column: s.column,
        valueMap: s.valueMap,
        fallback: s.fallback,
      }
    } else if (
      s?.type === 'rules' &&
      Array.isArray(s.rules) &&
      s.rules.every(
        (r: any) =>
          Number.isInteger(r?.column) &&
          typeof r?.contains === 'string' &&
          sectionKeys.has(r?.key),
      ) &&
      sectionKeys.has(s.fallback)
    ) {
      section = {
        type: 'rules',
        rules: s.rules.map((r: any) => ({
          column: r.column,
          contains: r.contains,
          key: r.key,
        })),
        fallback: s.fallback,
      }
    }

    const ok =
      Number.isInteger(m?.headerRows) &&
      m.headerRows >= 0 &&
      Number.isInteger(m?.labelColumn) &&
      m.labelColumn >= 0 &&
      !Number.isNaN(budgetColumn) &&
      !Number.isNaN(realColumn) &&
      (budgetColumn !== null || realColumn !== null) &&
      ['both', 'budget', 'real'].includes(m?.singleAmountTarget) &&
      section !== null &&
      ['absolute', 'negative-is-expense'].includes(m?.signConvention)

    if (!ok) {
      return {
        status: 'error',
        error: 'Mapping incomplet ou invalide renvoyé par l’IA. Réessayez ou utilisez le mode manuel.',
      }
    }

    const mapping: ImportMapping = {
      headerRows: m.headerRows,
      labelColumn: m.labelColumn,
      budgetColumn,
      realColumn,
      singleAmountTarget: m.singleAmountTarget,
      section: section!,
      skipRowIndexes: Array.isArray(m.skipRowIndexes)
        ? m.skipRowIndexes.filter((x: any) => Number.isInteger(x) && x >= 0)
        : [],
      ignoreLabelContains: Array.isArray(m.ignoreLabelContains)
        ? m.ignoreLabelContains.filter((x: any) => typeof x === 'string')
        : [],
      signConvention: m.signConvention,
    }
    const confidence = Number(parsed.confidence)
    return {
      status: 'mapping',
      mapping,
      confidence: Number.isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : 0.5,
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
    }
  }

  return { status: 'error', error: 'Réponse de l’IA dans un format inattendu.' }
}

export const analyzeImport = action({
  args: {
    // Échantillon du fichier (≤ ~20 lignes) — JAMAIS le fichier entier.
    sample: v.object({
      fileName: v.string(),
      rows: v.array(v.array(v.string())),
      totalRows: v.number(),
    }),
    // Rubriques de l'utilisateur (seules clés autorisées dans le mapping).
    sections: v.array(
      v.object({ key: v.string(), label: v.string(), kind: v.string() }),
    ),
    // Réponses cumulées des tours précédents (vide au premier appel).
    answers: v.array(v.object({ id: v.string(), value: v.string() })),
    // Numéro du tour courant (1..MAX_ROUNDS).
    round: v.number(),
  },
  handler: async (
    ctx,
    { sample, sections, answers, round },
  ): Promise<AnalyzeImportResult> => {
    // Garde-fou : pas de proxy IA gratuit pour les non-connectés.
    const userId = await getAuthUserId(ctx)
    if (userId === null) return { status: 'error', error: 'Non authentifié.' }

    if (sections.length === 0) {
      return { status: 'error', error: 'Aucune rubrique définie : créez d’abord vos rubriques.' }
    }

    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      return {
        status: 'error',
        error:
          'Clé DEEPSEEK_API_KEY manquante côté serveur (npx convex env set DEEPSEEK_API_KEY <clé>).',
      }
    }
    const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat'
    const baseUrl = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'

    // Borne dure côté serveur : échantillon limité même si le client triche.
    const rows = sample.rows.slice(0, 25).map((r) => r.slice(0, 30))

    // Message utilisateur : échantillon + réponses déjà collectées.
    let userMsg = `FICHIER : "${sample.fileName}" — ${sample.totalRows} ligne(s) au total (échantillon des ${rows.length} premières ci-dessous).\n\nÉCHANTILLON (une ligne par entrée, cellules séparées par " | ", index de ligne 0-based en préfixe) :\n`
    rows.forEach((r, i) => {
      userMsg += `${i}: ${r.join(' | ')}\n`
    })
    if (answers.length > 0) {
      userMsg += `\nRÉPONSES DÉJÀ DONNÉES PAR L'UTILISATEUR :\n`
      for (const a of answers) userMsg += `  - ${a.id} = ${a.value}\n`
    }
    userMsg += `\nTour ${Math.min(round, MAX_ROUNDS)}/${MAX_ROUNDS}. Réponds avec l'objet JSON demandé.`

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
          max_tokens: 1500,
          temperature: 0.1, // tâche structurée : on veut de la constance
          // Force une sortie JSON (le mot "JSON" figure bien dans les prompts).
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: buildSystemPrompt(sections, round) },
            { role: 'user', content: userMsg },
          ],
        }),
      })
    } catch (e) {
      return {
        status: 'error',
        error: `Impossible de contacter l'IA : ${e instanceof Error ? e.message : 'erreur réseau'}.`,
      }
    }

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      return {
        status: 'error',
        error: `Erreur IA (HTTP ${resp.status}). ${detail.slice(0, 200)}`,
      }
    }

    const json = await resp.json()
    const raw: string = (json?.choices?.[0]?.message?.content ?? '').trim()

    // Parsing défensif (même approche que vision.ts) : fences ```json``` puis
    // extraction du premier bloc {...} si le JSON n'est pas pur.
    let jsonText = raw
    const fence = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fence) jsonText = fence[1].trim()
    let parsed = tryParse(jsonText)
    if (parsed === undefined) {
      const block = jsonText.match(/[{][\s\S]*[}]/)
      if (block) parsed = tryParse(block[0])
    }
    if (parsed === undefined) {
      console.error('IMPORT IA — JSON illisible :', raw.slice(0, 1000))
      return { status: 'error', error: 'Réponse de l’IA illisible (JSON invalide). Réessayez.' }
    }

    const result = validateAiResult(parsed, new Set(sections.map((s) => s.key)))

    // Boucle bornée : passé MAX_ROUNDS, plus aucune question n'est acceptée.
    if (result.status === 'questions' && round >= MAX_ROUNDS) {
      return {
        status: 'error',
        error: 'L’IA n’a pas réussi à conclure en 3 tours. Utilisez le mode manuel.',
      }
    }
    return result
  },
})
