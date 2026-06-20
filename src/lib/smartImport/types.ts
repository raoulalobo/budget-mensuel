/**
 * Protocole de l'import intelligent (xls/xlsx/csv + agent IA).
 *
 * Ces types sont PARTAGÉS entre :
 *  - le client (SmartImportDialog, applyMapping) ;
 *  - l'action Convex `importMapping.analyzeImport` (en `import type` uniquement,
 *    donc effacés au build — aucun impact sur le bundling Convex).
 *
 * Principe : l'IA ne voit qu'un ÉCHANTILLON du fichier et ne renvoie JAMAIS de
 * données transformées — uniquement des questions à poser à l'utilisateur, puis
 * un MAPPING décrivant comment interpréter les colonnes. Le mapping est ensuite
 * appliqué de façon déterministe à toutes les lignes par `applyMapping`.
 */

/** Échantillon envoyé à l'IA (≤ ~20 lignes, cellules converties en string). */
export interface ImportSample {
  /** Nom du fichier (indice de contexte : "releve_janvier.csv"…). */
  fileName: string
  /** Lignes brutes, y compris l'éventuel en-tête. */
  rows: string[][]
  /** Nombre total de lignes du fichier (l'IA sait que l'échantillon est partiel). */
  totalRows: number
}

/**
 * Question structurée posée par l'IA à l'utilisateur.
 * Exemple : { id: "amount_target", text: "Quelle colonne correspond au montant réel ?",
 *             options: [{ value: "2", label: "Colonne C — « Montant »" }, …] }
 */
export interface ImportQuestion {
  /** Identifiant stable de la question (réutilisé dans la réponse). */
  id: string
  /** Texte de la question, en français. */
  text: string
  /** Choix proposés ; `value` est machine-exploitable (index de colonne, clé de rubrique…). */
  options: Array<{ value: string; label: string }>
  /** Autorise une réponse libre en plus des options. */
  allowFreeText?: boolean
}

/** Réponse de l'utilisateur à une question (cumulées sur tous les tours). */
export interface ImportAnswer {
  id: string
  value: string
}

/**
 * Stratégie d'affectation de rubrique pour chaque ligne :
 *  - `fixed`  : toutes les lignes vont dans une même rubrique ;
 *  - `column` : une colonne du fichier contient la catégorie ; `valueMap` traduit
 *               chaque valeur rencontrée vers une clé de rubrique existante,
 *               `fallback` sert pour les valeurs non mappées ;
 *  - `rules`  : règles "la colonne X contient le texte Y → rubrique Z",
 *               évaluées dans l'ordre, `fallback` sinon.
 * Les clés référencées doivent être des rubriques EXISTANTES de l'utilisateur.
 */
export type SectionStrategy =
  | { type: 'fixed'; key: string }
  | {
      type: 'column'
      column: number
      valueMap: Record<string, string>
      fallback: string
    }
  | {
      type: 'rules'
      rules: Array<{ column: number; contains: string; key: string }>
      fallback: string
    }

/**
 * Mapping complet produit par l'IA (ou par le repli manuel), appliqué
 * DÉTERMINISTIQUEMENT côté client par `applyMapping` sur tout le fichier.
 * Tous les index de colonnes sont 0-based.
 */
export interface ImportMapping {
  /** Nombre de lignes d'en-tête à sauter en début de fichier (0 si aucune). */
  headerRows: number
  /** Colonne du libellé de la ligne. */
  labelColumn: number
  /** Colonne du montant PRÉVU (null si absente du fichier). */
  budgetColumn: number | null
  /** Colonne du montant RÉEL (null si absente du fichier). */
  realColumn: number | null
  /**
   * Colonne de la DATE de la ligne (null si absente). La valeur est convertie en
   * ISO 'YYYY-MM-DD' par `parseDate` ; les cellules illisibles donnent une ligne
   * sans date (champ optionnel).
   */
  dateColumn?: number | null
  /**
   * Si le fichier n'a qu'UNE colonne de montant : où la verser.
   * 'both' = prévu ET réel (convention de l'app : réel absent → réel = prévu).
   */
  singleAmountTarget: 'both' | 'budget' | 'real'
  /** Comment déterminer la rubrique de chaque ligne. */
  section: SectionStrategy
  /** Index (0-based, fichier entier) de lignes précises à ignorer, vues dans l'échantillon. */
  skipRowIndexes: number[]
  /**
   * Filtre déterministe appliqué à TOUT le fichier : une ligne dont le libellé
   * contient l'un de ces fragments (insensible à la casse) est ignorée.
   * Exemple : ["total", "sous-total", "tva"].
   */
  ignoreLabelContains: string[]
  /**
   * Convention de signe des montants :
   *  - 'absolute' : les montants sont pris tels quels (valeur absolue) ;
   *  - 'negative-is-expense' : relevés bancaires signés — on prend la valeur
   *    absolue (la notion revenu/dépense est portée par la rubrique).
   */
  signConvention: 'absolute' | 'negative-is-expense'
}

/** Réponse de l'action Convex `analyzeImport`. */
export type AnalyzeImportResult =
  | { status: 'questions'; questions: ImportQuestion[] }
  | { status: 'mapping'; mapping: ImportMapping; confidence: number; notes: string }
  | { status: 'error'; error: string }

/** Rubrique transmise à l'IA (sous-ensemble de la table `sections`). */
export interface SectionInfo {
  key: string
  label: string
  /** 'income' ou 'expense' — aide l'IA à classer les lignes. */
  kind: string
}
