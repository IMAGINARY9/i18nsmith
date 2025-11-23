#!/usr/bin/env node
import fs from 'fs'
import path from 'path'

const packages = ['core', 'transformer', 'cli', 'translation']
let ok = true

for (const name of packages) {
  const pkgDir = path.resolve('packages', name)
  const pkgJsonPath = path.join(pkgDir, 'package.json')
  console.log(`\nPackage: @i18nsmith/${name}`)
  if (!fs.existsSync(pkgJsonPath)) {
    console.error(`  package.json missing at ${pkgJsonPath}`)
    ok = false
    continue
  }
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))

  const check = (field, rel) => {
    if (!rel) {
      console.warn(`  ${field}: not set`)
      ok = false
      return
    }
    const target = path.resolve(pkgDir, rel)
    if (fs.existsSync(target)) {
      console.log(`  ${field}: OK -> ${rel}`)
    } else {
      console.error(`  ${field}: MISSING -> ${rel}`)
      ok = false
    }
  }

  check('main', pkg.main)
  check('types', pkg.types)
  if (pkg.exports && pkg.exports['.']) {
    const exp = pkg.exports['.']
    if (typeof exp === 'string') {
      check('exports', exp)
    } else {
      check('exports.import', exp.import || exp)
      check('exports.types', exp.types || exp)
    }
  } else {
    console.warn('  exports: not defined')
  }
}

process.exit(ok ? 0 : 2)
