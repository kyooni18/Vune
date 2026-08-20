import { performance } from 'node:perf_hooks'
import { Text, VStack } from '../dist/index.js'

const itemCount = Number(process.env.RUI_BENCH_ITEMS ?? 5000)
const rounds = Number(process.env.RUI_BENCH_ROUNDS ?? 5)

function measure(name, factory) {
  const samples = []
  for (let round = 0; round < rounds; round += 1) {
    const start = performance.now()
    factory()
    samples.push(performance.now() - start)
  }
  const average = samples.reduce((sum, sample) => sum + sample, 0) / samples.length
  console.log(`${name}: ${average.toFixed(2)} ms (${itemCount} items, ${rounds} rounds)`)
}

measure('plain elements', () => {
  VStack(...Array.from({ length: itemCount }, (_, index) => Text(String(index))))
})

measure('deep modifier chains', () => {
  VStack(...Array.from({ length: itemCount }, (_, index) => Text(String(index))
    .padding(2)
    .margin(1)
    .background('Canvas')
    .foreground('CanvasText')
    .radius(4)
    .opacity(0.99)))
})
