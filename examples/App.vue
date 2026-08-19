<script lang="ts">
import { defineComponent, h, ref } from 'vue'
import {
  Button,
  Capsule,
  Circle,
  Component,
  Grid,
  HStack,
  Raw,
  Rectangle,
  RoundedRectangle,
  ScrollView,
  Spacer,
  Text,
  TextArea,
  TextField,
  Toggle,
  VStack,
  ZStack,
} from '../src/index'

const NativeBadge = defineComponent({
  name: 'NativeBadge',
  props: {
    label: { type: String, required: true },
  },
  setup(props) {
    return () => h(
      'span',
      {
        style: {
          padding: '3px 7px',
          border: '1px solid currentColor',
          borderRadius: '999px',
          fontSize: '12px',
        },
      },
      props.label,
    )
  },
})

export default defineComponent({
  name: 'App',

  setup() {
    const count = ref(0)
    const name = ref('Hare')
    const notes = ref('Normal Vue code and the DSL can coexist.')
    const enabled = ref(true)

    function increment() {
      count.value += 1
    }

    function decrement() {
      count.value -= 1
    }

    return function render() {
      return VStack(
        HStack(
          Text('Vune').fontSize(28).bold(),
          Spacer(),

          // Typed normal Vue component through the helper.
          Component(NativeBadge, { label: 'Vue component' }),
        ),

        Text(() => `Count: ${count.value}`).foreground('#666'),

        ZStack(
          RoundedRectangle(18)
            .height(150)
            .background('linear-gradient(135deg, #eef2ff, #f8fafc)'),

          VStack(
            Text('CSS-native shapes').fontSize(20).bold(),
            Text('ZStack + shape primitives stay ordinary Vue/CSS boxes.')
              .foreground('#667085'),
          )
            .gap(6)
            .padding(20),
        ),

        ScrollView(
          HStack(
            ZStack(
              Rectangle().width(96).height(64).background('#e2e8f0'),
              Text('Rectangle').fontSize(12),
            ),
            ZStack(
              RoundedRectangle(14).width(96).height(64).background('#dbeafe'),
              Text('Rounded').fontSize(12),
            ),
            ZStack(
              Circle().width(64).height(64).background('#ddd6fe'),
              Text('Circle').fontSize(12),
            ),
            ZStack(
              Capsule().width(112).height(48).background('#dcfce7'),
              Text('Capsule').fontSize(12),
            ),
          ).gap(12),
          'horizontal',
        )
          .padding('vertical', 4)
          .maxWidth('100%'),

        Grid(2,
          TextField(name, { placeholder: 'Name' })
            .padding(10)
            .radius(8)
            .border({ color: '#bbb' }),

          HStack(
            Toggle(enabled),
            Text(() => enabled.value ? 'Enabled' : 'Disabled'),
          ).gap(8),
        ).gap(10),

        TextArea(notes, { rows: 4 })
          .padding(10)
          .radius(8)
          .border({ color: '#bbb' }),

        HStack(
          Button('−', decrement),
          Button('+', increment),

          // A normal h() VNode can be inserted directly.
          h('em', null, 'plain h()'),

          // Raw() is only needed when adding modifiers to an existing VNode.
          Raw(h('strong', null, `Hello, ${name.value}`))
            .margin('left', 8),
        ).gap(8),
      )
        .gap(16)
        .padding(24)
        .frame({ maxWidth: 640 })
        .margin('horizontal', 'auto')
    }
  },
})
</script>
