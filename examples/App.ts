import { createElement } from 'react'
import {
  Alert,
  Button,
  Component,
  HStack,
  List,
  ScrollView,
  Sheet,
  Spacer,
  State,
  Text,
  TextField,
  Toggle,
  VStack,
  view,
} from '../src/index.js'

type Todo = {
  id: number
  title: string
  done: boolean
}

function SummaryCard({ total, completed }: { total: number; completed: number }) {
  return createElement(
    'aside',
    {
      'data-rui-react-summary': '',
      style: {
        padding: '14px 16px',
        border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
        borderRadius: '14px',
        minWidth: '150px',
      },
    },
    createElement('strong', null, `${completed}/${total}`),
    createElement('div', { style: { opacity: 0.68, marginTop: '4px' } }, 'completed'),
  )
}

const todos = State<Todo[]>([
  { id: 1, title: 'Try Rui with a real screen', done: true },
  { id: 2, title: 'Exercise nested State mutations', done: false },
])
const draft = State('')
const filter = State<'all' | 'open' | 'done'>('all')
const showSettings = State(false)
const showClearAlert = State(false)
const compactMode = State(false)

export default view(() => {
  const completed = todos.value.filter(todo => todo.done).length
  const visibleTodos = todos.value.filter(todo =>
    filter.value === 'all'
      || (filter.value === 'done' ? todo.done : !todo.done),
  )

  const addTodo = () => {
    const title = draft.value.trim()
    if (!title) return
    todos.value.push({ id: Date.now(), title, done: false })
    draft.value = ''
  }

  const todoRows = visibleTodos.length === 0
    ? [Text(filter.value === 'all' ? 'Nothing here yet.' : 'No matching tasks.').foreground('GrayText')]
    : visibleTodos.map(todo => HStack(
        { spacing: compactMode.value ? 8 : 12 },
        Button(todo.done ? '✓' : '○', () => { todo.done = !todo.done }, {
          'aria-label': todo.done ? `Mark ${todo.title} open` : `Complete ${todo.title}`,
        }).width(34).height(34).radius(17),
        Text(todo.title)
          .foreground(todo.done ? 'GrayText' : 'CanvasText')
          .style(todo.done ? { textDecoration: 'line-through' } : {})
          .grow(),
        Button('Delete', () => {
          todos.value = todos.value.filter(candidate => candidate.id !== todo.id)
        }, { 'aria-label': `Delete ${todo.title}` }).foreground('GrayText'),
      )
        .padding(compactMode.value ? 8 : 12)
        .background(todo.done ? 'color-mix(in srgb, currentColor 5%, transparent)' : 'transparent')
        .radius(12)
        .keyed(todo.id))

  return VStack(
    { alignment: 'leading', spacing: compactMode.value ? 12 : 18 },
    HStack(
      Text('Rui Tasks').fontSize(30).bold(),
      Spacer(),
      Button('Settings', () => { showSettings.value = true }),
    ),
    Text('A small end-to-end screen for the 1.0 alpha surface.').foreground('GrayText'),
    HStack(
      { spacing: 12 },
      Component(SummaryCard, { total: todos.value.length, completed })
        .background('Canvas')
        .shadow('0 8px 24px rgba(0, 0, 0, 0.08)'),
      VStack(
        { alignment: 'leading', spacing: 4 },
        Text(`${visibleTodos.length} visible`).fontSize(22).bold(),
        Text(filter.value === 'all' ? 'All tasks' : filter.value === 'done' ? 'Completed' : 'Open'),
      ).padding(4),
    ),
    HStack(
      { spacing: 8 },
      TextField(draft, { placeholder: 'Add a task', 'aria-label': 'New task' })
        .onKeyDown(event => { if (event.key === 'Enter') addTodo() })
        .padding(10)
        .border({ color: 'GrayText' })
        .radius(10)
        .grow(),
      Button('Add', addTodo),
    ),
    HStack(
      { spacing: 8 },
      Button('All', () => { filter.value = 'all' }).disabled(filter.value === 'all'),
      Button('Open', () => { filter.value = 'open' }).disabled(filter.value === 'open'),
      Button('Done', () => { filter.value = 'done' }).disabled(filter.value === 'done'),
      Spacer(),
      Button('Clear done', () => { showClearAlert.value = true }).disabled(completed === 0),
    ),
    ScrollView(List({ spacing: compactMode.value ? 6 : 10, separators: false }, ...todoRows))
      .frame({ maxHeight: 'infinity' })
      .grow(),
    Sheet(showSettings, VStack(
      { alignment: 'leading', spacing: 16 },
      HStack(Text('Settings').fontSize(22).bold(), Spacer(), Button('Done', () => { showSettings.value = false })),
      HStack(Text('Compact rows'), Spacer(), Toggle(compactMode, { 'aria-label': 'Compact rows' })),
      Text('This sheet is a Rui portal rendered with React DOM.').foreground('GrayText'),
    ).padding(24), { placement: 'center', ariaLabel: 'Settings' }),
    Alert(showClearAlert, {
      title: 'Clear completed tasks?',
      message: `${completed} completed task${completed === 1 ? '' : 's'} will be removed.`,
      actions: [
        { label: 'Cancel', role: 'cancel' },
        {
          label: 'Clear',
          role: 'destructive',
          action() {
            todos.value = todos.value.filter(todo => !todo.done)
          },
        },
      ],
    }),
  )
    .padding(24)
    .frame({ maxWidth: 760 })
    .margin('horizontal', 'auto')
    .style({ minHeight: '100vh', boxSizing: 'border-box' })
})
