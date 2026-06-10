/**
 * Lecture d'un fichier d'import (csv/tsv/txt/xls/xlsx) vers un tableau brut
 * de cellules string (`string[][]`), uniforme quel que soit le format.
 *
 *  - CSV/TSV : parser maison SANS dépendance, avec gestion des guillemets
 *    (`"1 234,56";"a;b"`) et détection automatique du délimiteur.
 *  - Excel (.xls/.xlsx) : SheetJS chargé en `import()` DYNAMIQUE — Vite crée un
 *    chunk séparé, le bundle principal ne grossit pas tant qu'aucun fichier
 *    Excel n'est sélectionné.
 *
 * Exemple :
 *   const table = await parseFileToTable(file)
 *   table.rows        // [["Poste","Prévu","Réel"], ["Loyer","800","800"], …]
 *   table.sheetNames  // ["Janvier","Février"] si classeur multi-feuilles
 */

/** Résultat de la lecture d'un fichier. */
export interface RawTable {
  /** Lignes × colonnes, cellules en string (telles qu'affichées). */
  rows: string[][]
  /** Noms des feuilles du classeur Excel (absent pour un CSV). */
  sheetNames?: string[]
  /** Feuille actuellement lue (absent pour un CSV). */
  sheetName?: string
}

/** Taille maximale acceptée (garde-fou mémoire/UX). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 Mo

/** Le fichier est-il un classeur Excel (par extension, le MIME étant peu fiable) ? */
export function isExcelFile(file: File): boolean {
  return /\.(xls|xlsx|xlsm|xlsb|ods)$/i.test(file.name)
}

/** Choisit le séparateur d'un texte CSV : tabulation > point-virgule > virgule. */
function detectDelimiter(text: string): string {
  // On regarde la première ligne non vide (hors guillemets, approximation suffisante).
  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? ''
  if (firstLine.includes('\t')) return '\t'
  if (firstLine.includes(';')) return ';'
  return ','
}

/**
 * Parse un texte CSV avec gestion des champs entre guillemets (RFC 4180) :
 *  - `"a;b"` ne se coupe pas sur le `;` interne ;
 *  - `""` à l'intérieur d'un champ quoté = guillemet échappé ;
 *  - les retours à la ligne DANS un champ quoté sont conservés.
 */
export function parseCsvText(text: string, delimiter?: string): string[][] {
  const delim = delimiter ?? detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"' // guillemet échappé ("")
          i++
        } else {
          inQuotes = false // fin du champ quoté
        }
      } else {
        cell += ch
      }
    } else if (ch === '"' && cell === '') {
      inQuotes = true // début d'un champ quoté
    } else if (ch === delim) {
      row.push(cell.trim())
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++ // CRLF → une seule fin de ligne
      row.push(cell.trim())
      cell = ''
      rows.push(row)
      row = []
    } else {
      cell += ch
    }
  }
  // Dernière cellule/ligne si le fichier ne se termine pas par un saut de ligne.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim())
    rows.push(row)
  }

  // Retire les lignes entièrement vides (fréquentes en fin de fichier).
  return rows.filter((r) => r.some((c) => c.length > 0))
}

/**
 * Lit une feuille d'un classeur Excel en tableau de strings.
 * `raw: false` demande à SheetJS les valeurs FORMATÉES (dates et montants tels
 * qu'affichés dans Excel), plus fiables pour un mapping par l'utilisateur.
 */
async function parseExcel(file: File, sheetName?: string): Promise<RawTable> {
  const XLSX = await import('xlsx') // lazy : chunk séparé chargé à la demande
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array' })
  const names = wb.SheetNames
  if (names.length === 0) throw new Error('Classeur vide (aucune feuille).')
  const name = sheetName && names.includes(sheetName) ? sheetName : names[0]
  const ws = wb.Sheets[name]
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, {
    header: 1, // tableau de tableaux (pas d'objets clés par en-tête)
    defval: '', // cellules vides → '' (lignes rectangulaires)
    raw: false, // valeurs formatées en string
    blankrows: false, // ignore les lignes totalement vides
  })
  return {
    rows: rows.map((r) => r.map((c) => String(c ?? '').trim())),
    sheetNames: names,
    sheetName: name,
  }
}

/**
 * Point d'entrée : lit un fichier csv/tsv/txt/xls/xlsx en `RawTable`.
 *
 * @param file      fichier choisi par l'utilisateur
 * @param sheetName feuille à lire (classeurs multi-feuilles ; défaut : la 1re)
 * @throws Error message en français, affichable tel quel ("Fichier illisible…")
 */
export async function parseFileToTable(
  file: File,
  sheetName?: string,
): Promise<RawTable> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `Fichier trop volumineux (${Math.round(file.size / 1024 / 1024)} Mo, maximum 10 Mo).`,
    )
  }
  try {
    if (isExcelFile(file)) return await parseExcel(file, sheetName)
    const text = await file.text()
    return { rows: parseCsvText(text) }
  } catch (e) {
    // Erreur de lecture/format (fichier corrompu, protégé par mot de passe…).
    if (e instanceof Error && e.message.startsWith('Fichier')) throw e
    throw new Error(
      `Fichier illisible (${e instanceof Error ? e.message : 'format non reconnu'}).`,
    )
  }
}
