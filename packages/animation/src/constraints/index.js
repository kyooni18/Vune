const OP_AFFINE = 1;
const OP_CLAMP = 2;
const OP_SUM = 3;
const OP_MIX = 4;
const OP_CUSTOM = 5;

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function isMotionValue(value) {
  return value && typeof value.get === 'function' && (typeof value._commit === 'function' || typeof value.set === 'function');
}

function nodeIndex(graph, node) {
  if (node instanceof ConstraintNode) {
    if (node.graph !== graph) throw new TypeError('Constraint node belongs to another graph.');
    return node.index;
  }
  if (typeof node === 'number') return graph.constant(node).index;
  throw new TypeError('Expected a ConstraintNode or finite constant.');
}

export class ConstraintNode {
  constructor(graph, index, name = '') {
    this.graph = graph;
    this.index = index;
    this.name = name;
  }

  get() { return this.graph.values[this.index]; }
  getVelocity() { return this.graph.velocities[this.index]; }
  set(value, velocity = 0) { this.graph.set(this, value, velocity); return this; }
}

export class ConstraintGraph {
  constructor({ engine = null } = {}) {
    this.values = [];
    this.velocities = [];
    this.bindings = [];
    this.nodes = [];
    this.operations = [];
    this.writerByNode = new Map();
    this.compiled = null;
    this.dirty = true;
    this.evaluating = false;
    this.engine = null;
    this.registered = false;
    this.unsubscribers = [];
    this.disposed = false;
    if (engine) this.attach(engine);
  }

  node(value = 0, { name = '' } = {}) {
    if (this.disposed) throw new Error('ConstraintGraph is disposed.');
    if (this.compiled) throw new Error('ConstraintGraph topology is locked after compile/evaluate. Build all nodes first.');
    const binding = isMotionValue(value) ? value : null;
    const initial = binding ? finite(binding.get()) : finite(value);
    const velocity = binding && typeof binding.getVelocity === 'function' ? finite(binding.getVelocity()) : 0;
    const index = this.values.length;
    this.values.push(initial);
    this.velocities.push(velocity);
    this.bindings.push(binding);
    const node = new ConstraintNode(this, index, name);
    this.nodes.push(node);
    if (binding) this.#subscribeBinding(binding);
    this.#invalidateCompile();
    return node;
  }

  constant(value, options) {
    if (!Number.isFinite(value)) throw new TypeError('Constraint constant must be finite.');
    return this.node(Number(value), options);
  }

  #subscribeBinding(binding) {
    const subscribe = binding.subscribeValue ?? binding.subscribe;
    if (typeof subscribe !== 'function') return;
    const unsubscribe = subscribe.call(binding, () => {
      if (!this.evaluating) this.invalidate();
    }, { emitCurrent: false });
    this.unsubscribers.push(unsubscribe);
  }

  #invalidateCompile() {
    this.compiled = null;
    this.dirty = true;
    this.invalidate();
  }

  #addOperation(type, target, sources, params = [], custom = null) {
    if (this.compiled) throw new Error('ConstraintGraph topology is locked after compile/evaluate. Build all constraints first.');
    const targetIndex = nodeIndex(this, target);
    if (this.writerByNode.has(targetIndex)) {
      throw new Error(`Constraint node '${this.nodes[targetIndex]?.name || targetIndex}' already has a writer.`);
    }
    const sourceIndices = sources.map((source) => nodeIndex(this, source));
    const operation = { type, target: targetIndex, sources: sourceIndices, params, custom };
    const opIndex = this.operations.length;
    this.operations.push(operation);
    this.writerByNode.set(targetIndex, opIndex);
    this.#invalidateCompile();
    return this;
  }

  affine(target, source, { scale = 1, offset = 0 } = {}) {
    return this.#addOperation(OP_AFFINE, target, [source], [finite(scale, 1), finite(offset)]);
  }

  follow(target, source, options) { return this.affine(target, source, options); }

  clamp(target, source, { min = -Infinity, max = Infinity } = {}) {
    if (min > max) throw new RangeError('Constraint clamp min cannot exceed max.');
    return this.#addOperation(OP_CLAMP, target, [source], [Number(min), Number(max)]);
  }

  sum(target, a, b, { scaleA = 1, scaleB = 1, offset = 0 } = {}) {
    return this.#addOperation(OP_SUM, target, [a, b], [finite(scaleA, 1), finite(scaleB, 1), finite(offset)]);
  }

  mix(target, a, b, progress) {
    return this.#addOperation(OP_MIX, target, [a, b, progress]);
  }

  map(target, inputs, compute) {
    if (!Array.isArray(inputs) || inputs.length === 0) throw new TypeError('Constraint map() requires at least one input.');
    if (typeof compute !== 'function') throw new TypeError('Constraint map() requires a compute callback.');
    return this.#addOperation(OP_CUSTOM, target, inputs, [], compute);
  }

  compile() {
    const count = this.operations.length;
    const indegree = new Int32Array(count);
    const outgoing = Array.from({ length: count }, () => []);
    for (let opIndex = 0; opIndex < count; opIndex += 1) {
      const operation = this.operations[opIndex];
      for (const source of operation.sources) {
        const writer = this.writerByNode.get(source);
        if (writer == null) continue;
        indegree[opIndex] += 1;
        outgoing[writer].push(opIndex);
      }
    }

    const queue = new Int32Array(Math.max(1, count));
    let head = 0;
    let tail = 0;
    for (let i = 0; i < count; i += 1) if (indegree[i] === 0) queue[tail++] = i;
    const order = new Int32Array(count);
    let ordered = 0;
    while (head < tail) {
      const opIndex = queue[head++];
      order[ordered++] = opIndex;
      for (const dependent of outgoing[opIndex]) {
        indegree[dependent] -= 1;
        if (indegree[dependent] === 0) queue[tail++] = dependent;
      }
    }
    if (ordered !== count) throw new Error('Constraint graph contains a dependency cycle.');

    const types = new Uint8Array(count);
    const targets = new Int32Array(count);
    const sourceA = new Int32Array(count); sourceA.fill(-1);
    const sourceB = new Int32Array(count); sourceB.fill(-1);
    const sourceC = new Int32Array(count); sourceC.fill(-1);
    const p0 = new Float64Array(count);
    const p1 = new Float64Array(count);
    const p2 = new Float64Array(count);
    const customs = new Array(count).fill(null);

    for (let slot = 0; slot < count; slot += 1) {
      const operation = this.operations[order[slot]];
      types[slot] = operation.type;
      targets[slot] = operation.target;
      sourceA[slot] = operation.sources[0] ?? -1;
      sourceB[slot] = operation.sources[1] ?? -1;
      sourceC[slot] = operation.sources[2] ?? -1;
      p0[slot] = operation.params[0] ?? 0;
      p1[slot] = operation.params[1] ?? 0;
      p2[slot] = operation.params[2] ?? 0;
      if (operation.type === OP_CUSTOM) {
        customs[slot] = {
          compute: operation.custom,
          sources: Int32Array.from(operation.sources),
          values: new Float64Array(operation.sources.length),
          velocities: new Float64Array(operation.sources.length),
        };
      }
    }

    this.values = Float64Array.from(this.values);
    this.velocities = Float64Array.from(this.velocities);
    const boundIndices = Int32Array.from(this.bindings.flatMap((binding, index) => binding ? [index] : []));
    const outputTargets = Int32Array.from(this.writerByNode.keys());
    this.compiled = { types, targets, sourceA, sourceB, sourceC, p0, p1, p2, customs, count, boundIndices, outputTargets };
    return this;
  }

  set(node, value, velocity = 0) {
    const index = nodeIndex(this, node);
    const next = finite(value, this.values[index]);
    const nextVelocity = finite(velocity);
    this.values[index] = next;
    this.velocities[index] = nextVelocity;
    const binding = this.bindings[index];
    if (binding) {
      this.evaluating = true;
      try {
        if (typeof binding._commit === 'function') binding._commit(next, nextVelocity);
        else binding.set(next, nextVelocity);
      } finally { this.evaluating = false; }
    }
    this.invalidate();
    return this;
  }

  invalidate() {
    if (this.disposed) return;
    this.dirty = true;
    if (this.engine && !this.registered) {
      this.registered = true;
      this.engine.addDriver(this);
    }
  }

  evaluate() {
    if (this.disposed) return false;
    if (!this.compiled) this.compile();
    const values = this.values;
    const velocities = this.velocities;

    const c = this.compiled;
    for (let k = 0; k < c.boundIndices.length; k += 1) {
      const i = c.boundIndices[k];
      const binding = this.bindings[i];
      values[i] = finite(binding.get(), values[i]);
      velocities[i] = typeof binding.getVelocity === 'function' ? finite(binding.getVelocity()) : velocities[i];
    }

    this.evaluating = true;
    try {
      for (let i = 0; i < c.count; i += 1) {
        const target = c.targets[i];
        const aIndex = c.sourceA[i];
        const bIndex = c.sourceB[i];
        const cIndex = c.sourceC[i];
        const a = aIndex >= 0 ? values[aIndex] : 0;
        const va = aIndex >= 0 ? velocities[aIndex] : 0;
        switch (c.types[i]) {
          case OP_AFFINE: {
            values[target] = a * c.p0[i] + c.p1[i];
            velocities[target] = va * c.p0[i];
            break;
          }
          case OP_CLAMP: {
            const min = c.p0[i];
            const max = c.p1[i];
            const next = Math.min(max, Math.max(min, a));
            values[target] = next;
            velocities[target] = next === a ? va : 0;
            break;
          }
          case OP_SUM: {
            const b = values[bIndex];
            values[target] = a * c.p0[i] + b * c.p1[i] + c.p2[i];
            velocities[target] = va * c.p0[i] + velocities[bIndex] * c.p1[i];
            break;
          }
          case OP_MIX: {
            const b = values[bIndex];
            const t = values[cIndex];
            const vb = velocities[bIndex];
            const vt = velocities[cIndex];
            values[target] = a + (b - a) * t;
            velocities[target] = va * (1 - t) + vb * t + (b - a) * vt;
            break;
          }
          case OP_CUSTOM: {
            const custom = c.customs[i];
            for (let j = 0; j < custom.sources.length; j += 1) {
              const source = custom.sources[j];
              custom.values[j] = values[source];
              custom.velocities[j] = velocities[source];
            }
            const result = custom.compute(custom.values, custom.velocities, this);
            if (result && typeof result === 'object') {
              values[target] = finite(result.value, values[target]);
              velocities[target] = finite(result.velocity);
            } else {
              values[target] = finite(result, values[target]);
              velocities[target] = 0;
            }
            break;
          }
          default: throw new Error(`Unknown constraint operation ${c.types[i]}.`);
        }
      }

      for (let k = 0; k < c.outputTargets.length; k += 1) {
        const target = c.outputTargets[k];
        const binding = this.bindings[target];
        if (!binding) continue;
        const next = values[target];
        const velocity = velocities[target];
        if (typeof binding._commit === 'function') binding._commit(next, velocity);
        else binding.set(next, velocity);
      }
    } finally {
      this.evaluating = false;
      this.dirty = false;
    }
    return true;
  }

  step() {
    this.registered = false;
    if (this.dirty) this.evaluate();
    return false;
  }

  attach(engine) {
    if (!engine?.addDriver) throw new TypeError('ConstraintGraph.attach() requires a MotionEngine-like engine.');
    this.engine = engine;
    this.invalidate();
    return this;
  }

  detach() {
    if (this.engine && this.registered) this.engine.removeDriver(this);
    this.registered = false;
    this.engine = null;
    return this;
  }

  dispose() {
    if (this.disposed) return;
    this.detach();
    for (const unsubscribe of this.unsubscribers) unsubscribe?.();
    this.unsubscribers.length = 0;
    this.disposed = true;
  }
}

export function createConstraintGraph(options) {
  return new ConstraintGraph(options);
}
