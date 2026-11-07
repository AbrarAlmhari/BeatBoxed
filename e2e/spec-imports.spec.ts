import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from './fixtures'
import { assertSpecsUseTheMock, specsSkippingTheMock } from './spec-imports'

// Put together so this file doesn't trip its own check.
const PLAYWRIGHT = ['@playwright', 'test'].join('/')

test.describe('the check that every spec uses the Spotify mock', () => {
  let dir: string

  test.beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'spec-imports-'))
  })
  test.afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const write = (name: string, source: string) => writeFileSync(join(dir, name), source)

  test('every spec in this project passes', () => {
    expect(specsSkippingTheMock(fileURLToPath(new URL('./', import.meta.url)))).toEqual([])
  })

  test('a spec importing from the fixtures passes', () => {
    write('good.spec.ts', `import { test, expect, type Page } from './fixtures'\n`)
    expect(specsSkippingTheMock(dir)).toEqual([])
    expect(() => assertSpecsUseTheMock(dir)).not.toThrow()
  })

  test('a spec importing from Playwright directly is caught, and named', () => {
    write('good.spec.ts', `import { test } from './fixtures'\n`)
    write('bad.spec.ts', `import { test, expect, type Page } from '${PLAYWRIGHT}'\n`)
    expect(specsSkippingTheMock(dir)).toEqual(['bad.spec.ts'])
    expect(() => assertSpecsUseTheMock(dir)).toThrow(/bad\.spec\.ts/)
  })

  test('so is one that also imports the fixtures, or only a type from Playwright', () => {
    write('both.spec.ts', `import { test } from './fixtures'\nimport { expect } from "${PLAYWRIGHT}"\n`)
    write('type.spec.ts', `import { test } from './fixtures'\nimport type { Page } from '${PLAYWRIGHT}'\n`)
    expect(specsSkippingTheMock(dir)).toEqual(['both.spec.ts', 'type.spec.ts'])
  })

  test('so is a spec with no fixtures import at all', () => {
    write('none.spec.ts', `const nothing = 1\n`)
    expect(specsSkippingTheMock(dir)).toEqual(['none.spec.ts'])
  })

  test('specs in a subfolder count too, and other files do not', () => {
    mkdirSync(join(dir, 'nested'))
    write('nested/deep.spec.ts', `import { test } from '${PLAYWRIGHT}'\n`)
    write('nested/ok.spec.ts', `import { test } from '../fixtures'\n`)
    write('fixtures.ts', `import { test } from '${PLAYWRIGHT}'\n`)
    expect(specsSkippingTheMock(dir)).toEqual(['nested/deep.spec.ts'])
  })
})
