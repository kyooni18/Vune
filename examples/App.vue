<script lang="ts">
import { h, ref } from 'vue'
import {
  Button,
  Capsule,
  Circle,
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
  View,
  VStack,
  ZStack,
} from '../src/index'

export default View({
  name: 'App',

  state: () => ({
    count: ref(0),
    name: ref('Hare'),
    notes: ref('Vune can hide Vue render boilerplate while keeping Vue reactivity.'),
    enabled: ref(true),
  }),

  body: ({ count, name, notes, enabled }) =>
    VStack(
      { alignment: 'leading', spacing: 16 },

      HStack(
        { spacing: 12 },
        Text('Vune').fontSize(28).bold(),
        Spacer(),
        Text('Declarative Vue').foreground('#667085'),
      )
        .frame({ maxWidth: 'infinity' }),

      Text(() => `Count: ${count.value}`)
        .foreground('#666')
        .frame({ maxWidth: 'infinity', alignment: 'leading' }),

      ZStack(
        { alignment: 'center' },
        RoundedRectangle(18)
          .height(150)
          .background('linear-gradient(135deg, #eef2ff, #f8fafc)'),
        VStack(
          { alignment: 'center', spacing: 6 },
          Text('No setup() or render()').fontSize(20).bold(),
          Text('View() keeps those details inside Vune.')
            .foreground('#667085'),
        )
          .padding(20),
      )
        .frame({ maxWidth: 'infinity' }),

      ScrollView(
        HStack(
          { spacing: 12 },
          ZStack(Rectangle().width(96).height(64).background('#e2e8f0'), Text('Rectangle').fontSize(12)),
          ZStack(RoundedRectangle(14).width(96).height(64).background('#dbeafe'), Text('Rounded').fontSize(12)),
          ZStack(Circle().width(64).height(64).background('#ddd6fe'), Text('Circle').fontSize(12)),
          ZStack(Capsule().width(112).height(48).background('#dcfce7'), Text('Capsule').fontSize(12)),
        ),
        'horizontal',
      )
        .padding('vertical', 4)
        .maxWidth('100%'),

      Grid(
        2,
        TextField(name, { placeholder: 'Name' })
          .padding(10)
          .radius(8)
          .border({ color: '#bbb' }),
        HStack(
          { spacing: 8 },
          Toggle(enabled),
          Text(() => enabled.value ? 'Enabled' : 'Disabled'),
        ),
      ).gap(10),

      TextArea(notes, { rows: 4 })
        .padding(10)
        .radius(8)
        .border({ color: '#bbb' }),

      HStack(
        { spacing: 8 },
        Button('−', () => count.value -= 1),
        Button('+', () => count.value += 1),
        Spacer(),
        h('em', null, 'plain Vue VNode'),
        Raw(h('strong', null, `Hello, ${name.value}`)).margin('left', 8),
      )
        .frame({ maxWidth: 'infinity' }),
    )
      .padding(24)
      .frame({ maxWidth: 640 })
      .margin('horizontal', 'auto'),
})
</script>
