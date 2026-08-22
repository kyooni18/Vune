import { Button, State, Text, VStack } from "muse"
import { view } from "@muse/react"

const count = State(0)

export default view(() => VStack(spacing: 12) {
  Text(`Count: ${count.value}`)
  Button("Increment") {
    count.value += 1
  }
})
