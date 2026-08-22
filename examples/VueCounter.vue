<script setup lang="ts">
import { Button, State, Text, VStack } from "muse"
import { MuseView } from "@muse/vue"

const count = State(0)

const graph = () => VStack() {
  Text(`Count: ${count.value}`).fontSize(24).bold()
  Text("This graph is rendered by the Vue adapter.")
  // Muse State remains renderer-independent; Vue only owns the SFC boundary.
  Button("Increment") { count.value += 1 }
}
</script>

<template>
  <MuseView :render="graph" />
</template>
