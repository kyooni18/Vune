typedef unsigned int u32;
typedef unsigned long uptr;

extern unsigned char __heap_base;
static u32 heap_cursor = 0;

__attribute__((export_name("motion_reset_allocator")))
void motion_reset_allocator(void) {
  heap_cursor = (u32)(uptr)&__heap_base;
}

__attribute__((export_name("motion_alloc")))
u32 motion_alloc(u32 bytes, u32 alignment) {
  if (heap_cursor == 0) motion_reset_allocator();
  if (alignment == 0) alignment = 1;
  u32 aligned = (heap_cursor + alignment - 1u) & ~(alignment - 1u);
  u32 end = aligned + bytes;
  if (end < aligned) return 0;

  const u32 page_bytes = 65536u;
  u32 current_pages = (u32)__builtin_wasm_memory_size(0);
  u32 current_bytes = current_pages * page_bytes;
  if (end > current_bytes) {
    u32 needed_pages = (end + page_bytes - 1u) / page_bytes;
    u32 grow_pages = needed_pages - current_pages;
    if (__builtin_wasm_memory_grow(0, grow_pages) == (unsigned long)-1) return 0;
  }

  heap_cursor = end;
  return aligned;
}

#define MAX_STEP_SECONDS (1.0f / 240.0f)
#define MAX_SUBSTEPS 32u

#ifdef MOTION_SIMD
typedef float f32x4 __attribute__((vector_size(16)));
#endif

__attribute__((export_name("step_springs")))
void step_springs(
  float* positions,
  float* velocities,
  const float* targets,
  const float* omegas,
  const float* damping_ratios,
  u32 count,
  float dt_seconds
) {
  if (count == 0 || dt_seconds <= 0.0f) return;

  u32 steps = 1u;
  while ((dt_seconds / (float)steps) > MAX_STEP_SECONDS && steps < MAX_SUBSTEPS) steps += 1u;
  const float h = dt_seconds / (float)steps;

  for (u32 s = 0; s < steps; s += 1u) {
    u32 i = 0u;
#ifdef MOTION_SIMD
    const f32x4 two = {2.0f, 2.0f, 2.0f, 2.0f};
    const f32x4 hv = {h, h, h, h};
    for (; i + 4u <= count; i += 4u) {
      f32x4 x = *(f32x4*)(positions + i);
      f32x4 v = *(f32x4*)(velocities + i);
      const f32x4 target = *(const f32x4*)(targets + i);
      const f32x4 omega = *(const f32x4*)(omegas + i);
      const f32x4 zeta = *(const f32x4*)(damping_ratios + i);
      const f32x4 acceleration = omega * omega * (target - x) - two * zeta * omega * v;
      v = v + acceleration * hv;
      x = x + v * hv;
      *(f32x4*)(positions + i) = x;
      *(f32x4*)(velocities + i) = v;
    }
#endif
    for (; i < count; i += 1u) {
      float x = positions[i];
      float v = velocities[i];
      const float omega = omegas[i];
      const float acceleration = omega * omega * (targets[i] - x) - 2.0f * damping_ratios[i] * omega * v;
      v += acceleration * h;
      x += v * h;
      positions[i] = x;
      velocities[i] = v;
    }
  }
}
