export const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));

export async function parallel(...factories) {
  return Promise.all(factories.map((factory) => {
    const result = typeof factory === 'function' ? factory() : factory;
    return result?.finished ?? result;
  }));
}

export async function sequence(...factories) {
  const results = [];
  for (const factory of factories) {
    const result = typeof factory === 'function' ? factory() : factory;
    results.push(await (result?.finished ?? result));
  }
  return results;
}
