import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const FROM_FIXTURES = /from\s+['"](?:\.\.?\/)+fixtures['"]/
const FROM_PLAYWRIGHT = /['"]@playwright\/test['"]/

/**
 * The specs under `dir` that would run without the Spotify mock: they import
 * from Playwright directly, or don't import from the fixtures at all.
 */
export function specsSkippingTheMock(dir: string): string[] {
  const specs = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.spec.ts'))
  return specs
    .filter((name) => {
      const source = readFileSync(join(dir, name), 'utf8')
      return FROM_PLAYWRIGHT.test(source) || !FROM_FIXTURES.test(source)
    })
    .map((name) => name.replaceAll('\\', '/'))
    .sort()
}

/**
 * Called from playwright.config.ts, so a run stops before any spec or browser
 * starts, even when only one file was asked for. The test in e2e/spotify.spec.ts
 * only speaks up after the specs before it have already run.
 */
export function assertSpecsUseTheMock(dir: string) {
  const skipping = specsSkippingTheMock(dir)
  if (skipping.length === 0) return
  throw new Error(
    `These specs skip the Spotify mock, so they could reach the real Spotify:\n` +
      skipping.map((name) => `  ${name}`).join('\n') +
      `\nImport test and expect from './fixtures' instead of '@playwright/test'.`
  )
}
