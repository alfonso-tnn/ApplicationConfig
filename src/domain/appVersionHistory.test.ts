import { describe, expect, it } from 'vitest'
import {
  normalizeAppVersionHistory,
  rememberAppVersion,
  removeAppVersion,
} from './appVersionHistory'

describe('app version history', () => {
  it('normalizes stored values and removes duplicates', () => {
    expect(
      normalizeAppVersionHistory([
        ' 26.02-15 ',
        null,
        '25.01-93',
        '26.02-15',
        '',
      ]),
    ).toEqual(['26.02-15', '25.01-93'])
    expect(normalizeAppVersionHistory({ version: '26.02-15' })).toEqual([])
  })

  it('moves a remembered version to the front without duplicating it', () => {
    expect(
      rememberAppVersion(['25.01-93', '24.12-12'], ' 24.12-12 '),
    ).toEqual(['24.12-12', '25.01-93'])
  })

  it('ignores empty versions and limits the saved history', () => {
    const history = Array.from({ length: 20 }, (_, index) => `version-${index}`)

    expect(rememberAppVersion(history, '   ')).toBe(history)
    expect(rememberAppVersion(history, 'new-version')).toEqual([
      'new-version',
      ...history.slice(0, 19),
    ])
  })

  it('removes only the selected saved version', () => {
    expect(
      removeAppVersion(['26.02-15', '25.01-93'], '26.02-15'),
    ).toEqual(['25.01-93'])
  })
})