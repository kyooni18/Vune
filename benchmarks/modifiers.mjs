import { performance } from 'node:perf_hooks'
import { createElement } from 'react'
import { Text, VStack } from '../dist/index.js'

const defaultCounts = process.env.RUI_BENCH_CI === '1' ? [100, 1000] : [100, 1000, 10000]
const itemCounts = (process.env.RUI_BENCH_ITEMS ?? defaultCounts.join(','))
  .split(',')
  .map(value => Number(value.trim()))
  .filter(value => Number.isFinite(value) && value > 0)
const depths = [1, 5, 10, 20]
const rounds = Number(process.env.RUI_BENCH_ROUNDS ?? (process.env.RUI_BENCH_CI === '1' ? 2 : 5))
const results = []

function measure(name, itemCount, factory) {
  const samples = []
  for (let round = 0; round < rounds; round += 1) {
    const start = performance.now()
    factory()
    samples.push(performance.now() - start)
  }
  const average = samples.reduce((sum, sample) => sum + sample, 0) / samples.length
  results.push({ name, itemCount, average })
  console.log(`${name}: ${average.toFixed(2)} ms (${itemCount} items, ${rounds} rounds)`)
  return average
}

const modifierSteps = [
  element => element.padding(2),
  element => element.margin(1),
  element => element.background('Canvas'),
  element => element.foreground('CanvasText'),
  element => element.radius(4),
  element => element.opacity(0.99),
  element => element.fontSize(14),
  element => element.fontWeight(500),
  element => element.lineHeight(1.2),
  element => element.textAlign('left'),
  element => element.grow(1),
  element => element.shrink(1),
  element => element.flex('0 1 auto'),
  element => element.wrap('nowrap'),
  element => element.order(0),
  element => element.align('stretch'),
  element => element.justify('flex-start'),
  element => element.position('relative'),
  element => element.overflow('visible'),
  element => element.cursor('default'),
]

const rawStyle = {
  padding: '2px',
  margin: '1px',
  background: 'Canvas',
  color: 'CanvasText',
  borderRadius: '4px',
  opacity: 0.99,
  fontSize: '14px',
  fontWeight: 500,
  lineHeight: 1.2,
  textAlign: 'left',
  flexGrow: 1,
  flexShrink: 1,
  flex: '0 1 auto',
  flexWrap: 'nowrap',
  order: 0,
  alignItems: 'stretch',
  justifyContent: 'flex-start',
  position: 'relative',
  overflow: 'visible',
  cursor: 'default',
}

for (const itemCount of itemCounts) {
  const raw = measure('raw React style', itemCount, () => {
    VStack(...Array.from({ length: itemCount }, (_, index) => createElement('span', {
      key: index,
      style: rawStyle,
    }, String(index))))
  })

  for (const depth of depths) {
    const average = measure(`Rui modifier chain depth ${depth}`, itemCount, () => {
      VStack(...Array.from({ length: itemCount }, (_, index) => {
        let element = Text(String(index))
        for (let step = 0; step < depth; step += 1) element = modifierSteps[step % modifierSteps.length](element)
        return element
      }))
    })
    if (process.env.RUI_BENCH_MAX_RATIO && average / Math.max(raw, 0.001) > Number(process.env.RUI_BENCH_MAX_RATIO)) {
      throw new Error(`Rui modifier chain exceeded the configured ratio at ${itemCount} items and depth ${depth}`)
    }
  }
}

if (results.some(result => !Number.isFinite(result.average))) {
  throw new Error('Modifier benchmark produced a non-finite measurement')
}
