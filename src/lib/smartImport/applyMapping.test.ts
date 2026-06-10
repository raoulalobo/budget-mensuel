import { describe, expect, it } from 'vitest'
import { applyMapping, validateMapping } from './applyMapping'
import { parseCsvText } from './parseFile'
import type { ImportMapping } from './types'

/**
 * Tests du cœur déterministe de l'import intelligent :
 *  - `parseCsvText` : CSV quoté, délimiteurs, lignes vides ;
 *  - `applyMapping` : application d'un mapping IA à un tableau brut.
 */

/** Rubriques de test (mêmes clés que les rubriques par défaut de l'app). */
const SECTIONS = [
  { key: 'income', label: 'Revenus' },
  { key: 'fixed', label: 'Dépenses fixes' },
  { key: 'variable', label: 'Dépenses variables' },
]

/** Mapping de base réutilisé par les tests (surcharger au besoin). */
function mapping(overrides: Partial<ImportMapping> = {}): ImportMapping {
  return {
    headerRows: 1,
    labelColumn: 0,
    budgetColumn: 1,
    realColumn: 2,
    singleAmountTarget: 'both',
    section: { type: 'fixed', key: 'fixed' },
    skipRowIndexes: [],
    ignoreLabelContains: [],
    signConvention: 'absolute',
    ...overrides,
  }
}

describe('parseCsvText', () => {
  it('détecte le délimiteur point-virgule et découpe les colonnes', () => {
    const rows = parseCsvText('Poste;Prévu;Réel\nLoyer;800;800')
    expect(rows).toEqual([
      ['Poste', 'Prévu', 'Réel'],
      ['Loyer', '800', '800'],
    ])
  })

  it('gère les champs entre guillemets contenant le délimiteur', () => {
    const rows = parseCsvText('"Loyer; charges";"1 234,56";"800"')
    expect(rows).toEqual([['Loyer; charges', '1 234,56', '800']])
  })

  it('gère les guillemets échappés ("") dans un champ quoté', () => {
    const rows = parseCsvText('"Abonnement ""Premium""";10')
    expect(rows).toEqual([['Abonnement "Premium"', '10']])
  })

  it('supporte tabulation et virgule comme délimiteurs', () => {
    expect(parseCsvText('a\tb\tc')).toEqual([['a', 'b', 'c']])
    expect(parseCsvText('a,b,c')).toEqual([['a', 'b', 'c']])
  })

  it('ignore les lignes entièrement vides (fin de fichier, CRLF)', () => {
    const rows = parseCsvText('a;b\r\n\r\nc;d\r\n')
    expect(rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })
})

describe('applyMapping', () => {
  it('applique un mapping simple (en-tête + 2 colonnes de montant)', () => {
    const table = [
      ['Poste', 'Prévu', 'Réel'],
      ['Loyer', '800', '795,50'],
      ['Électricité', '1 234,56 €', ''],
    ]
    const res = applyMapping(table, mapping(), SECTIONS)
    expect(res.errors).toEqual([])
    expect(res.skipped).toBe(1) // l'en-tête
    expect(res.entries).toEqual([
      { section: 'fixed', label: 'Loyer', budget: 800, real: 795.5 },
      { section: 'fixed', label: 'Électricité', budget: 1234.56, real: 0 },
    ])
  })

  it('ventile une colonne de montant unique vers prévu ET réel (both)', () => {
    const table = [['Salaire', '2500']]
    const res = applyMapping(
      table,
      mapping({
        headerRows: 0,
        budgetColumn: null,
        realColumn: 1,
        singleAmountTarget: 'both',
        section: { type: 'fixed', key: 'income' },
      }),
      SECTIONS,
    )
    expect(res.entries).toEqual([
      { section: 'income', label: 'Salaire', budget: 2500, real: 2500 },
    ])
  })

  it("ventile une colonne unique vers le réel seul (real)", () => {
    const table = [['Courses', '54,30']]
    const res = applyMapping(
      table,
      mapping({
        headerRows: 0,
        budgetColumn: null,
        realColumn: 1,
        singleAmountTarget: 'real',
      }),
      SECTIONS,
    )
    expect(res.entries[0]).toMatchObject({ budget: 0, real: 54.3 })
  })

  it('prend la valeur absolue avec la convention negative-is-expense', () => {
    const table = [['CB Carrefour', '-45,90']]
    const res = applyMapping(
      table,
      mapping({
        headerRows: 0,
        budgetColumn: null,
        realColumn: 1,
        signConvention: 'negative-is-expense',
        section: { type: 'fixed', key: 'variable' },
      }),
      SECTIONS,
    )
    expect(res.entries[0]).toMatchObject({ real: 45.9 })
  })

  it('ignore les lignes de totaux via ignoreLabelContains et skipRowIndexes', () => {
    const table = [
      ['Loyer', '800'],
      ['TOTAL DÉPENSES', '800'],
      ['ligne pointée par l’IA', '999'],
    ]
    const res = applyMapping(
      table,
      mapping({
        headerRows: 0,
        budgetColumn: 1,
        realColumn: null,
        ignoreLabelContains: ['total'],
        skipRowIndexes: [2],
      }),
      SECTIONS,
    )
    expect(res.entries).toHaveLength(1)
    expect(res.entries[0].label).toBe('Loyer')
    expect(res.skipped).toBe(2)
  })

  it('résout la rubrique via une colonne de catégorie (valueMap + fallback)', () => {
    const table = [
      ['Loyer', '800', 'Logement'],
      ['Salaire', '2500', 'Paie'],
      ['Mystère', '10', 'Inconnu'],
    ]
    const res = applyMapping(
      table,
      mapping({
        headerRows: 0,
        budgetColumn: 1,
        realColumn: null,
        section: {
          type: 'column',
          column: 2,
          // Les clés du valueMap sont comparées insensibles à la casse.
          valueMap: { logement: 'fixed', Paie: 'income' },
          fallback: 'variable',
        },
      }),
      SECTIONS,
    )
    expect(res.entries.map((e) => e.section)).toEqual([
      'fixed',
      'income',
      'variable',
    ])
  })

  it('résout la rubrique via des règles "contient" (rules + fallback)', () => {
    const table = [
      ['VIR SALAIRE ACME', '2500'],
      ['PRLV EDF', '60'],
      ['CB BOULANGERIE', '4'],
    ]
    const res = applyMapping(
      table,
      mapping({
        headerRows: 0,
        budgetColumn: 1,
        realColumn: null,
        section: {
          type: 'rules',
          rules: [
            { column: 0, contains: 'salaire', key: 'income' },
            { column: 0, contains: 'edf', key: 'fixed' },
          ],
          fallback: 'variable',
        },
      }),
      SECTIONS,
    )
    expect(res.entries.map((e) => e.section)).toEqual([
      'income',
      'fixed',
      'variable',
    ])
  })

  it('signale les montants illisibles (mis à 0) et exclut les libellés vides', () => {
    const table = [
      ['Loyer', 'abc'],
      ['', '50'],
    ]
    const res = applyMapping(
      table,
      mapping({ headerRows: 0, budgetColumn: 1, realColumn: null }),
      SECTIONS,
    )
    expect(res.entries).toHaveLength(1)
    expect(res.entries[0]).toMatchObject({ label: 'Loyer', budget: 0 })
    expect(res.errors).toHaveLength(2) // montant illisible + libellé manquant
  })

  it('rejette un mapping invalide (colonne hors bornes, rubrique inconnue)', () => {
    const table = [['Loyer', '800']]
    const bad = mapping({
      headerRows: 0,
      labelColumn: 9, // hors bornes
      section: { type: 'fixed', key: 'nimporte' }, // rubrique inexistante
    })
    const res = applyMapping(table, bad, SECTIONS)
    expect(res.entries).toEqual([])
    expect(res.errors.length).toBeGreaterThanOrEqual(2)
  })

  it('validateMapping exige au moins une colonne de montant', () => {
    const problems = validateMapping(
      mapping({ budgetColumn: null, realColumn: null }),
      3,
      SECTIONS,
    )
    expect(problems.some((p) => p.includes('montant'))).toBe(true)
  })
})
