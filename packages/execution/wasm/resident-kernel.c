typedef unsigned int u32;
typedef unsigned long uptr;

extern unsigned char __heap_base;
static u32 heap_cursor = 0;

#define MAX_STACK 128u
#define MAX_OUTPUTS 64u

enum resident_opcode {
  OP_END = 0u,
  OP_KERNEL = 1u,
  OP_CONST_F32 = 2u,
  OP_LOAD_COLUMN = 3u,
  OP_INDEX = 4u,
  OP_CAPTURE = 5u,
  OP_POSITIVE = 6u,
  OP_NEGATIVE = 7u,
  OP_NOT = 8u,
  OP_ADD = 9u,
  OP_SUBTRACT = 10u,
  OP_MULTIPLY = 11u,
  OP_DIVIDE = 12u,
  OP_LESS_THAN = 13u,
  OP_LESS_EQUAL = 14u,
  OP_GREATER_THAN = 15u,
  OP_GREATER_EQUAL = 16u,
  OP_EQUAL = 17u,
  OP_NOT_EQUAL = 18u,
  OP_AND = 19u,
  OP_OR = 20u,
  OP_SELECT = 21u,
  OP_STORE_TEMP = 22u,
  OP_COMMIT = 23u,
};

typedef union f32_bits {
  float value;
  u32 bits;
} f32_bits;

__attribute__((export_name("resident_reset_allocator")))
void resident_reset_allocator(void) {
  heap_cursor = (u32)(uptr)&__heap_base;
}

__attribute__((export_name("resident_alloc")))
u32 resident_alloc(u32 bytes, u32 alignment) {
  if (heap_cursor == 0u) resident_reset_allocator();
  if (alignment == 0u) alignment = 1u;
  if ((alignment & (alignment - 1u)) != 0u) return 0u;
  const u32 aligned = (heap_cursor + alignment - 1u) & ~(alignment - 1u);
  const u32 end = aligned + bytes;
  if (end < aligned) return 0u;
  const u32 memory_bytes = (u32)__builtin_wasm_memory_size(0) * 65536u;
  if (end > memory_bytes) return 0u;
  heap_cursor = end;
  return aligned;
}

__attribute__((export_name("resident_simd_enabled")))
u32 resident_simd_enabled(void) {
#ifdef RESIDENT_SIMD
  return 1u;
#else
  return 0u;
#endif
}

static int binary_scalar(u32 opcode, float left, float right, float* output) {
  switch (opcode) {
    case OP_ADD: *output = left + right; return 1;
    case OP_SUBTRACT: *output = left - right; return 1;
    case OP_MULTIPLY: *output = left * right; return 1;
    case OP_DIVIDE: *output = left / right; return 1;
    case OP_LESS_THAN: *output = left < right ? 1.0f : 0.0f; return 1;
    case OP_LESS_EQUAL: *output = left <= right ? 1.0f : 0.0f; return 1;
    case OP_GREATER_THAN: *output = left > right ? 1.0f : 0.0f; return 1;
    case OP_GREATER_EQUAL: *output = left >= right ? 1.0f : 0.0f; return 1;
    case OP_EQUAL: *output = left == right ? 1.0f : 0.0f; return 1;
    case OP_NOT_EQUAL: *output = left != right ? 1.0f : 0.0f; return 1;
    case OP_AND: *output = left != 0.0f && right != 0.0f ? 1.0f : 0.0f; return 1;
    case OP_OR: *output = left != 0.0f || right != 0.0f ? 1.0f : 0.0f; return 1;
    default: return 0;
  }
}

static int execute_scalar_row(
  const u32* program,
  u32 program_words,
  float** columns,
  u32 column_count,
  const float* captures,
  u32 capture_count,
  u32 row
) {
  float stack[MAX_STACK];
  float outputs[MAX_OUTPUTS];
  u32 output_columns[MAX_OUTPUTS];
  u32 stack_size = 0u;
  u32 output_count = 0u;
  u32 expected_outputs = 0u;
  u32 pc = 0u;

  while (pc < program_words) {
    const u32 opcode = program[pc++];
    if (opcode == OP_END) return expected_outputs == 0u ? 0 : 8;
    if (opcode == OP_KERNEL) {
      if (pc >= program_words || expected_outputs != 0u) return 2;
      expected_outputs = program[pc++];
      if (expected_outputs == 0u || expected_outputs > MAX_OUTPUTS) return 3;
      output_count = 0u;
      continue;
    }
    if (opcode == OP_CONST_F32) {
      if (pc >= program_words || stack_size >= MAX_STACK) return 4;
      f32_bits value = { .bits = program[pc++] };
      stack[stack_size++] = value.value;
      continue;
    }
    if (opcode == OP_LOAD_COLUMN) {
      if (pc >= program_words || stack_size >= MAX_STACK) return 4;
      const u32 column = program[pc++];
      if (column >= column_count) return 5;
      stack[stack_size++] = columns[column][row];
      continue;
    }
    if (opcode == OP_INDEX) {
      if (stack_size >= MAX_STACK) return 4;
      stack[stack_size++] = (float)row;
      continue;
    }
    if (opcode == OP_CAPTURE) {
      if (pc >= program_words || stack_size >= MAX_STACK) return 4;
      const u32 capture = program[pc++];
      if (capture >= capture_count) return 6;
      stack[stack_size++] = captures[capture];
      continue;
    }
    if (opcode == OP_POSITIVE || opcode == OP_NEGATIVE || opcode == OP_NOT) {
      if (stack_size < 1u) return 4;
      if (opcode == OP_NEGATIVE) stack[stack_size - 1u] = -stack[stack_size - 1u];
      if (opcode == OP_NOT) stack[stack_size - 1u] = stack[stack_size - 1u] == 0.0f ? 1.0f : 0.0f;
      continue;
    }
    if (opcode >= OP_ADD && opcode <= OP_OR) {
      if (stack_size < 2u) return 4;
      const float right = stack[--stack_size];
      const float left = stack[stack_size - 1u];
      if (!binary_scalar(opcode, left, right, &stack[stack_size - 1u])) return 7;
      continue;
    }
    if (opcode == OP_SELECT) {
      if (stack_size < 3u) return 4;
      const float when_false = stack[--stack_size];
      const float when_true = stack[--stack_size];
      const float condition = stack[stack_size - 1u];
      stack[stack_size - 1u] = condition != 0.0f ? when_true : when_false;
      continue;
    }
    if (opcode == OP_STORE_TEMP) {
      if (pc >= program_words || stack_size < 1u || output_count >= expected_outputs) return 8;
      const u32 column = program[pc++];
      if (column >= column_count) return 5;
      outputs[output_count] = stack[--stack_size];
      output_columns[output_count++] = column;
      continue;
    }
    if (opcode == OP_COMMIT) {
      if (expected_outputs == 0u || output_count != expected_outputs || stack_size != 0u) return 8;
      for (u32 i = 0u; i < output_count; i += 1u) columns[output_columns[i]][row] = outputs[i];
      expected_outputs = 0u;
      output_count = 0u;
      continue;
    }
    return 7;
  }
  return 1;
}

#ifdef RESIDENT_SIMD
typedef float f32x4 __attribute__((vector_size(16)));
typedef int i32x4 __attribute__((vector_size(16)));

typedef union vector_bits {
  f32x4 values;
  i32x4 bits;
} vector_bits;

static f32x4 vector_boolean(i32x4 mask) {
  return -__builtin_convertvector(mask, f32x4);
}

static f32x4 vector_select(i32x4 mask, f32x4 when_true, f32x4 when_false) {
  vector_bits left = { .values = when_true };
  vector_bits right = { .values = when_false };
  vector_bits result = { .bits = (mask & left.bits) | (~mask & right.bits) };
  return result.values;
}

static int binary_vector(u32 opcode, f32x4 left, f32x4 right, f32x4* output) {
  const f32x4 zero = {0.0f, 0.0f, 0.0f, 0.0f};
  switch (opcode) {
    case OP_ADD: *output = left + right; return 1;
    case OP_SUBTRACT: *output = left - right; return 1;
    case OP_MULTIPLY: *output = left * right; return 1;
    case OP_DIVIDE: *output = left / right; return 1;
    case OP_LESS_THAN: *output = vector_boolean(left < right); return 1;
    case OP_LESS_EQUAL: *output = vector_boolean(left <= right); return 1;
    case OP_GREATER_THAN: *output = vector_boolean(left > right); return 1;
    case OP_GREATER_EQUAL: *output = vector_boolean(left >= right); return 1;
    case OP_EQUAL: *output = vector_boolean(left == right); return 1;
    case OP_NOT_EQUAL: *output = vector_boolean(left != right); return 1;
    case OP_AND: *output = vector_boolean((left != zero) & (right != zero)); return 1;
    case OP_OR: *output = vector_boolean((left != zero) | (right != zero)); return 1;
    default: return 0;
  }
}

static int execute_vector_row(
  const u32* program,
  u32 program_words,
  float** columns,
  u32 column_count,
  const float* captures,
  u32 capture_count,
  u32 row
) {
  f32x4 stack[MAX_STACK];
  f32x4 outputs[MAX_OUTPUTS];
  u32 output_columns[MAX_OUTPUTS];
  u32 stack_size = 0u;
  u32 output_count = 0u;
  u32 expected_outputs = 0u;
  u32 pc = 0u;
  const f32x4 index_value = {(float)row, (float)(row + 1u), (float)(row + 2u), (float)(row + 3u)};
  const f32x4 zero = {0.0f, 0.0f, 0.0f, 0.0f};

  while (pc < program_words) {
    const u32 opcode = program[pc++];
    if (opcode == OP_END) return expected_outputs == 0u ? 0 : 8;
    if (opcode == OP_KERNEL) {
      if (pc >= program_words || expected_outputs != 0u) return 2;
      expected_outputs = program[pc++];
      if (expected_outputs == 0u || expected_outputs > MAX_OUTPUTS) return 3;
      output_count = 0u;
      continue;
    }
    if (opcode == OP_CONST_F32) {
      if (pc >= program_words || stack_size >= MAX_STACK) return 4;
      f32_bits value = { .bits = program[pc++] };
      stack[stack_size++] = (f32x4){value.value, value.value, value.value, value.value};
      continue;
    }
    if (opcode == OP_LOAD_COLUMN) {
      if (pc >= program_words || stack_size >= MAX_STACK) return 4;
      const u32 column = program[pc++];
      if (column >= column_count) return 5;
      stack[stack_size++] = *(f32x4*)(columns[column] + row);
      continue;
    }
    if (opcode == OP_INDEX) {
      if (stack_size >= MAX_STACK) return 4;
      stack[stack_size++] = index_value;
      continue;
    }
    if (opcode == OP_CAPTURE) {
      if (pc >= program_words || stack_size >= MAX_STACK) return 4;
      const u32 capture = program[pc++];
      if (capture >= capture_count) return 6;
      const float value = captures[capture];
      stack[stack_size++] = (f32x4){value, value, value, value};
      continue;
    }
    if (opcode == OP_POSITIVE || opcode == OP_NEGATIVE || opcode == OP_NOT) {
      if (stack_size < 1u) return 4;
      if (opcode == OP_NEGATIVE) stack[stack_size - 1u] = -stack[stack_size - 1u];
      if (opcode == OP_NOT) stack[stack_size - 1u] = vector_boolean(stack[stack_size - 1u] == zero);
      continue;
    }
    if (opcode >= OP_ADD && opcode <= OP_OR) {
      if (stack_size < 2u) return 4;
      const f32x4 right = stack[--stack_size];
      const f32x4 left = stack[stack_size - 1u];
      if (!binary_vector(opcode, left, right, &stack[stack_size - 1u])) return 7;
      continue;
    }
    if (opcode == OP_SELECT) {
      if (stack_size < 3u) return 4;
      const f32x4 when_false = stack[--stack_size];
      const f32x4 when_true = stack[--stack_size];
      const f32x4 condition = stack[stack_size - 1u];
      stack[stack_size - 1u] = vector_select(condition != zero, when_true, when_false);
      continue;
    }
    if (opcode == OP_STORE_TEMP) {
      if (pc >= program_words || stack_size < 1u || output_count >= expected_outputs) return 8;
      const u32 column = program[pc++];
      if (column >= column_count) return 5;
      outputs[output_count] = stack[--stack_size];
      output_columns[output_count++] = column;
      continue;
    }
    if (opcode == OP_COMMIT) {
      if (expected_outputs == 0u || output_count != expected_outputs || stack_size != 0u) return 8;
      for (u32 i = 0u; i < output_count; i += 1u) *(f32x4*)(columns[output_columns[i]] + row) = outputs[i];
      expected_outputs = 0u;
      output_count = 0u;
      continue;
    }
    return 7;
  }
  return 1;
}
#endif

/**
 * Execute every fused kernel over every dirty range. The JavaScript boundary
 * makes exactly one call; row iteration and kernel fusion remain in WASM.
 */
__attribute__((export_name("resident_execute")))
u32 resident_execute(
  const u32* program,
  u32 program_words,
  const u32* column_pointers,
  u32 column_count,
  const u32* ranges,
  u32 range_count,
  const float* captures,
  u32 capture_count
) {
  if (program == 0 || column_pointers == 0 || ranges == 0 || column_count == 0u) return 9u;
  float* columns[64];
  if (column_count > 64u) return 5u;
  for (u32 column = 0u; column < column_count; column += 1u) {
    if (column_pointers[column] == 0u) return 5u;
    columns[column] = (float*)(uptr)column_pointers[column];
  }
  for (u32 range_index = 0u; range_index < range_count; range_index += 1u) {
    const u32 start = ranges[range_index * 2u];
    const u32 end = ranges[range_index * 2u + 1u];
    if (end < start) return 10u;
    u32 row = start;
#ifdef RESIDENT_SIMD
    for (; row + 4u <= end; row += 4u) {
      const int result = execute_vector_row(program, program_words, columns, column_count, captures, capture_count, row);
      if (result != 0) return (u32)result;
    }
#endif
    for (; row < end; row += 1u) {
      const int result = execute_scalar_row(program, program_words, columns, column_count, captures, capture_count, row);
      if (result != 0) return (u32)result;
    }
  }
  return 0u;
}
