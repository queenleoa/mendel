// Verifies the dihybrid F2 segregation by running the live algorithm
// 1000 times against the same homozygous founders we mint, then
// printing the observed phenotype distribution + the "one-of-each"
// guarantee outcome.
//
// Run: node scripts/verify-mendel.mjs

import { keccak256, solidityPacked } from 'ethers'

// =====================================================================
// Mirror of the production PRNG + recombination, with single-letter
// allele tags so the output is grep-able.
// =====================================================================

function makeSeededPrng(seed) {
  let counter = 0
  function nextU32() {
    const h = keccak256(
      solidityPacked(['bytes32', 'uint256'], [seed, counter++]),
    )
    return parseInt(h.slice(2, 10), 16)
  }
  function sampleOne(arr) {
    if (arr.length === 0) throw new Error('empty')
    return arr[nextU32() % arr.length]
  }
  return { sampleOne }
}

function f2Gamete(prng, parentA, parentB) {
  const f1FromA = prng.sampleOne(parentA)
  const f1FromB = prng.sampleOne(parentB)
  return prng.sampleOne([f1FromA, f1FromB])
}

const TRIGGER_DOMINANT = 'M'
const FILTER_DOMINANT = 'N'

function pickDominance(locus, a, b) {
  const dom = locus === 'trigger' ? TRIGGER_DOMINANT : FILTER_DOMINANT
  if (a === dom || b === dom) return dom
  return a
}

const ALL_PHENOTYPES = [
  { trigger: 'M', filter: 'N' },
  { trigger: 'M', filter: 'W' },
  { trigger: 'R', filter: 'N' },
  { trigger: 'R', filter: 'W' },
]

function buildAllelesForPhenotype(prng, poolA, poolB, target, isDominant) {
  const pool = [...poolA, ...poolB]
  const matching = pool.filter((a) => a === target)
  const other = pool.filter((a) => a !== target)
  if (matching.length === 0) return [prng.sampleOne(pool), prng.sampleOne(pool)]
  if (!isDominant || other.length === 0) {
    return [prng.sampleOne(matching), prng.sampleOne(matching)]
  }
  return [prng.sampleOne(matching), prng.sampleOne(other)]
}

function buildChildForPhenotype(prng, parentA, parentB, pheno) {
  const t = buildAllelesForPhenotype(
    prng,
    parentA.trigger,
    parentB.trigger,
    pheno.trigger,
    pheno.trigger === TRIGGER_DOMINANT,
  )
  const f = buildAllelesForPhenotype(
    prng,
    parentA.filter,
    parentB.filter,
    pheno.filter,
    pheno.filter === FILTER_DOMINANT,
  )
  return {
    triggerAlleles: t,
    filterAlleles: f,
    triggerPhenotype: pheno.trigger,
    filterPhenotype: pheno.filter,
  }
}

function buildRandomF2Child(prng, parentA, parentB) {
  const tx = f2Gamete(prng, parentA.trigger, parentB.trigger)
  const ty = f2Gamete(prng, parentA.trigger, parentB.trigger)
  const fx = f2Gamete(prng, parentA.filter, parentB.filter)
  const fy = f2Gamete(prng, parentA.filter, parentB.filter)
  return {
    triggerAlleles: [tx, ty],
    filterAlleles: [fx, fy],
    triggerPhenotype: pickDominance('trigger', tx, ty),
    filterPhenotype: pickDominance('filter', fx, fy),
  }
}

function phenoKey(c) {
  return `${c.triggerPhenotype}|${c.filterPhenotype}`
}

function mendelianRecombine(parentA, parentB, seed, count = 9) {
  const prng = makeSeededPrng(seed)
  const children = []
  for (let i = 0; i < count; i++) {
    children.push(buildRandomF2Child(prng, parentA, parentB))
  }
  if (count >= ALL_PHENOTYPES.length) {
    const present = new Set(children.map(phenoKey))
    const missing = ALL_PHENOTYPES.filter(
      (p) => !present.has(`${p.trigger}|${p.filter}`),
    )
    if (missing.length > 0) {
      const seen = new Set()
      const replaceable = []
      for (let i = 0; i < children.length; i++) {
        const k = phenoKey(children[i])
        if (seen.has(k)) replaceable.push(i)
        else seen.add(k)
      }
      for (const pheno of missing) {
        const idx = replaceable.shift()
        if (idx === undefined) break
        children[idx] = buildChildForPhenotype(prng, parentA, parentB, pheno)
      }
    }
  }
  return children
}

// =====================================================================
// Run.
// =====================================================================

const PARENT_F1 = { trigger: ['M', 'M'], filter: ['N', 'N'] }
const PARENT_F2 = { trigger: ['R', 'R'], filter: ['W', 'W'] }
const SEEDS = 1000
const COUNT = 9

const phenotypeCounts = { 'M-N': 0, 'M-W': 0, 'R-N': 0, 'R-W': 0 }
const breedDoubleRecessiveCounts = new Map()
let breedsWithAllFour = 0
let breedsRequiringRescue = 0
const rescuesByCombo = { 'M-N': 0, 'M-W': 0, 'R-N': 0, 'R-W': 0 }

for (let s = 1; s <= SEEDS; s++) {
  const seedHex =
    '0x' + keccak256(solidityPacked(['uint256'], [BigInt(s)])).slice(2)

  // Snapshot the natural draw to count rescues.
  const naturalPrng = makeSeededPrng(seedHex)
  const natural = []
  for (let i = 0; i < COUNT; i++) {
    natural.push(buildRandomF2Child(naturalPrng, PARENT_F1, PARENT_F2))
  }
  const naturalPhenoSet = new Set(natural.map(phenoKey))
  if (naturalPhenoSet.size < 4) breedsRequiringRescue++
  for (const p of ALL_PHENOTYPES) {
    if (!naturalPhenoSet.has(`${p.trigger}|${p.filter}`)) {
      rescuesByCombo[`${p.trigger}-${p.filter}`]++
    }
  }

  // Now the actual full algorithm with rescue.
  const children = mendelianRecombine(PARENT_F1, PARENT_F2, seedHex, COUNT)
  const phenoSet = new Set(children.map(phenoKey))
  if (phenoSet.size === 4) breedsWithAllFour++

  let drInBreed = 0
  for (const c of children) {
    const k = `${c.triggerPhenotype}-${c.filterPhenotype}`
    phenotypeCounts[k]++
    if (k === 'R-W') drInBreed++
  }
  breedDoubleRecessiveCounts.set(
    drInBreed,
    (breedDoubleRecessiveCounts.get(drInBreed) ?? 0) + 1,
  )
}

const totalChildren = SEEDS * COUNT
const fmt = (n, total) => `${n} (${((n / total) * 100).toFixed(2)}%)`

console.log(`\n${SEEDS} simulated breeds × ${COUNT} children = ${totalChildren} total children\n`)

console.log('PHENOTYPE distribution (post-rescue)')
for (const k of ['M-N', 'M-W', 'R-N', 'R-W']) {
  console.log(`  ${k}: ${fmt(phenotypeCounts[k], totalChildren)}`)
}

console.log(
  `\nBREEDS containing all 4 phenotype combos: ${fmt(breedsWithAllFour, SEEDS)}`,
)
console.log(
  `BREEDS that needed at least one rescue:    ${fmt(breedsRequiringRescue, SEEDS)}`,
)

console.log('\nRESCUE injections per combo (over all breeds):')
for (const k of ['M-N', 'M-W', 'R-N', 'R-W']) {
  console.log(`  ${k}: ${rescuesByCombo[k]}`)
}

console.log('\nDOUBLE-RECESSIVE (R-W) count per breed of 9:')
for (const k of [...breedDoubleRecessiveCounts.keys()].sort((a, b) => a - b)) {
  console.log(`  ${k} per breed: ${fmt(breedDoubleRecessiveCounts.get(k), SEEDS)}`)
}
