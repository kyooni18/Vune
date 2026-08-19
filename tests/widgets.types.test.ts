import { h, ref } from 'vue'
import {
  Alert,
  Image,
  Label,
  LazyGrid,
  LazyHStack,
  LazyVStack,
  Link,
  List,
  Menu,
  NavigationLink,
  NavigationStack,
  Picker,
  ProgressView,
  Section,
  Sheet,
  Slider,
  Stepper,
  Text,
  type RouterLike,
} from '../src/index.js'

Image('/photo.jpg', { alt: 'Photo', fit: 'cover', loading: 'lazy' })
Label('Profile', Text('●'))
Link('Docs', '/docs', { target: '_blank' })
ProgressView(0.4, { max: 1, label: 'Loading' })
ProgressView()

const choice = ref<'a' | 'b'>('a')
Picker(choice, [
  { label: 'A', value: 'a' },
  { label: 'B', value: 'b' },
])

// @ts-expect-error picker values must match the selection ref type
Picker(choice, [{ label: 'C', value: 3 }])

const amount = ref(0.5)
Slider(amount, { min: 0, max: 1, step: 0.1 })
Stepper(amount, { min: 0, max: 2, step: 0.5 })

List(
  { spacing: 8, inset: 12 },
  Section('General', Text('A'), Text('B')),
  Text('C'),
)

LazyVStack({ alignment: 'leading', estimatedItemSize: 56 }, Text('A'), Text('B'))
LazyHStack({ alignment: 'center', estimatedItemSize: 80 }, Text('A'), Text('B'))
LazyGrid({ columns: 2, estimatedItemSize: 120 }, Text('A'), Text('B'))

const router: RouterLike = {
  push(destination) {
    void destination
  },
  back() {},
}

NavigationStack(
  router,
  NavigationLink('/profile', 'Profile'),
  NavigationLink({ name: 'settings' }, Text('Settings')),
)

const showingSheet = ref(false)
Sheet(showingSheet, Text('Sheet'))
Alert(showingSheet, {
  title: 'Confirm',
  actions: [
    { label: 'OK' },
    { label: 'Delete', role: 'destructive', action: () => {} },
  ],
})
Menu('Actions', Text('Edit'), h('button', null, 'Delete'))
