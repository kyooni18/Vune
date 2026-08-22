/**
 * Compatibility module: built-in Views are renderer-independent and are owned
 * by @muse/core. Keeping this path avoids breaking existing React imports.
 */
export {
  BindingValue,
  Button,
  Divider,
  Element,
  ForEach,
  Group,
  HStack,
  LazyHStack,
  LazyVStack,
  List,
  Section,
  Spacer,
  Text,
  VStack,
  ZStack,
} from "@muse/core"
export type { HStackOptions, VStackOptions, ZStackOptions } from "@muse/core"
