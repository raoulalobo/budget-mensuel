import { describe, expect, it } from 'vitest'
import { parseAmount, parseDate } from './csv'

/**
 * Tests des parsers d'import « à la française » :
 *  - `parseAmount` : montants avec devise/séparateurs ;
 *  - `parseDate`   : dates en formats courants → ISO 'YYYY-MM-DD'.
 */

describe('parseAmount', () => {
  it('lit un montant français avec devise et séparateurs', () => {
    expect(parseAmount('1 234,56 €')).toBe(1234.56)
  })
  it('gère le format anglais et les cas vides', () => {
    expect(parseAmount('10.5')).toBe(10.5)
    expect(parseAmount('')).toBe(0)
    expect(parseAmount('abc')).toBe(0)
  })
})

describe('parseDate', () => {
  it('accepte le format ISO', () => {
    expect(parseDate('2025-01-15')).toBe('2025-01-15')
    // Ignore une éventuelle partie heure.
    expect(parseDate('2025-01-15T08:30:00')).toBe('2025-01-15')
  })
  it('convertit le format français jour/mois/année', () => {
    expect(parseDate('15/01/2025')).toBe('2025-01-15')
    expect(parseDate('15-01-2025')).toBe('2025-01-15')
    expect(parseDate('05/03/2025')).toBe('2025-03-05')
  })
  it('complète une année sur 2 chiffres en 20xx', () => {
    expect(parseDate('15/01/25')).toBe('2025-01-15')
  })
  it('rejette les dates impossibles ou illisibles', () => {
    expect(parseDate('31/02/2025')).toBeUndefined() // 31 février
    expect(parseDate('00/01/2025')).toBeUndefined() // jour 0
    expect(parseDate('15/13/2025')).toBeUndefined() // mois 13
    expect(parseDate('')).toBeUndefined()
    expect(parseDate('pas une date')).toBeUndefined()
  })
})
