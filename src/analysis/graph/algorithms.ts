/** Generic graph algorithms over adjacency maps. */

export function reachableFrom(
  starts: Iterable<string>,
  adjacency: Map<string, string[]>,
): Set<string> {
  const seen = new Set<string>();
  const stack = [...starts];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of adjacency.get(id) ?? []) if (!seen.has(next)) stack.push(next);
  }
  return seen;
}

/** Strongly connected components (iterative Tarjan). */
export function stronglyConnectedComponents(
  nodes: Iterable<string>,
  adjacency: Map<string, string[]>,
): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];

  for (const root of nodes) {
    if (indices.has(root)) continue;
    const work: { id: string; next: number }[] = [{ id: root, next: 0 }];
    indices.set(root, index);
    low.set(root, index++);
    stack.push(root);
    onStack.add(root);
    while (work.length) {
      const frame = work[work.length - 1]!;
      const succ = adjacency.get(frame.id) ?? [];
      if (frame.next < succ.length) {
        const w = succ[frame.next++]!;
        if (!indices.has(w)) {
          indices.set(w, index);
          low.set(w, index++);
          stack.push(w);
          onStack.add(w);
          work.push({ id: w, next: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.id, Math.min(low.get(frame.id)!, indices.get(w)!));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!));
      if (low.get(frame.id) === indices.get(frame.id)) {
        const component: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
        } while (w !== frame.id);
        result.push(component);
      }
    }
  }
  return result;
}

/** Components that contain a cycle (size > 1, or a self-loop). */
export function cycles(nodes: Iterable<string>, adjacency: Map<string, string[]>): string[][] {
  return stronglyConnectedComponents(nodes, adjacency).filter(
    (c) => c.length > 1 || (adjacency.get(c[0]!) ?? []).includes(c[0]!),
  );
}
