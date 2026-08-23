import { Button, Text, VStack } from 'vune-ui'
import { view } from '@vune-ui/react'
import './App.css'

struct __VUNE_PROJECT_APP_NAME__: View {
  @State var count = 0

  var body: some View {
    VStack(spacing: 12) {
      Text('Hello, Vune')
      Text(`Count: ${count.value}`)
      Button('Increase') { count.value += 1 }
    }
  }
}

export default view(() => __VUNE_PROJECT_APP_NAME__())
