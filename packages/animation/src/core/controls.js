export class AnimationControls {
  constructor(cancel, finish, promise) {
    this.cancel = cancel;
    this.finish = finish;
    this.finished = promise;
  }
}

export function deferredControls() {
  let resolver;
  let settled = false;
  const finished = new Promise((resolve) => { resolver = resolve; });
  return {
    finished,
    settle(result) {
      if (settled) return;
      settled = true;
      resolver(result);
    },
    get settled() { return settled; },
  };
}
