/**
 * The Data Inputs / Data Outputs that data associations connect to (BPMN 2.0.2
 * §10.4.1, PDF 251-254): a DataInputAssociation targets a Data Input of the
 * activity's InputOutputSpecification (or of the throw event), a
 * DataOutputAssociation starts at a Data Output of the activity (or of the
 * catch event). Drawing a data association creates that Data Input / Output;
 * deleting it removes it again when nothing else uses it.
 */
import type { Connection } from 'diagram-js/lib/model/Types';
import { getMany, getRef, is, walkContainment, type ModdleElement } from '@/bpmn/model/moddle';
import type { ChangeLog } from './ChangeLog';
import type { SemanticModel } from './semanticModel';

type Direction = 'input' | 'output';

const KEYS = {
  input: {
    type: 'bpmn:DataInput',
    list: 'dataInputs',
    sets: 'inputSets',
    setType: 'bpmn:InputSet',
    refs: ['dataInputRefs', 'optionalInputRefs', 'whileExecutingInputRefs'],
  },
  output: {
    type: 'bpmn:DataOutput',
    list: 'dataOutputs',
    sets: 'outputSets',
    setType: 'bpmn:OutputSet',
    refs: ['dataOutputRefs', 'optionalOutputRefs', 'whileExecutingOutputRefs'],
  },
} as const;

/** Where `owner` keeps its data inputs / outputs: the activity's I/O specification or the event. */
function holderOf(owner: ModdleElement): ModdleElement | undefined {
  return is(owner, 'bpmn:Activity') ? getRef(owner, 'ioSpecification') : owner;
}

/**
 * Creates (once per connection, reused on redo) the Data Input / Output of
 * `owner` that a data association drawn from or to `data` uses, and registers
 * it in the first input / output set of an activity.
 */
export function addAssociationIo(
  m: SemanticModel,
  connection: Connection,
  owner: ModdleElement,
  data: ModdleElement,
  direction: Direction,
  log: ChangeLog,
): ModdleElement {
  const keys = KEYS[direction];
  const io = m.created(connection, direction, () =>
    m.factory.createModdle(keys.type, data.name ? { name: data.name } : {}),
  );
  let holder = owner;
  if (is(owner, 'bpmn:Activity')) {
    let spec = getRef(owner, 'ioSpecification');
    if (!spec) {
      spec = m.created(connection, 'ioSpecification', () =>
        m.factory.createModdle('bpmn:InputOutputSpecification'),
      );
      log.setParent(spec, owner);
      log.set(owner, 'ioSpecification', spec);
    }
    // An InputOutputSpecification has at least one input set and one output set.
    for (const d of ['input', 'output'] as const) {
      if (getMany(spec, KEYS[d].sets).length) continue;
      const set = m.created(connection, KEYS[d].sets, () =>
        m.factory.createModdle(KEYS[d].setType),
      );
      m.insertInto(spec, KEYS[d].sets, set, log);
    }
    holder = spec;
  }
  if (!getMany(holder, keys.list).includes(io)) m.insertInto(holder, keys.list, io, log);
  if (holder !== owner) {
    const set = getMany(holder, keys.sets)[0]!;
    const refs = set.get(keys.refs[0]) as ModdleElement[];
    if (!refs.includes(io)) log.insert(refs, io);
  }
  return io;
}

/** Whether any element of the definitions other than `except` references `target`. */
function referencedElsewhere(
  definitions: ModdleElement,
  target: ModdleElement,
  except: Set<ModdleElement>,
): boolean {
  let found = false;
  walkContainment(definitions, (el) => {
    if (found || except.has(el)) return;
    for (const prop of el.$descriptor?.properties ?? []) {
      if (!prop.isReference) continue;
      const value = (el as unknown as Record<string, unknown>)[prop.name];
      if (value === target || (Array.isArray(value) && value.includes(target))) {
        found = true;
        return;
      }
    }
  });
  return found;
}

/**
 * Removes the Data Input / Output a deleted data association used, when it
 * belongs to `owner` and nothing else (another association, a loop data
 * input...) refers to it; then an activity's I/O specification that became
 * empty goes too.
 */
export function removeAssociationIo(
  m: SemanticModel,
  flow: ModdleElement,
  owner: ModdleElement,
  direction: Direction,
  log: ChangeLog,
): void {
  const keys = KEYS[direction];
  const io = direction === 'input' ? getRef(flow, 'targetRef') : getMany(flow, 'sourceRef')[0];
  const holder = holderOf(owner);
  if (!io || !holder || !is(io, keys.type) || io.$parent !== holder) return;
  // Sets list their data inputs / outputs; those references do not keep them alive.
  const sets = new Set(getMany(holder, keys.sets));
  if (referencedElsewhere(m.definitions, io, new Set([flow, ...sets]))) return;
  log.remove(holder.get(keys.list) as ModdleElement[], io);
  for (const set of sets) {
    for (const key of keys.refs) log.remove(set.get(key) as ModdleElement[], io);
  }
  if (holder === owner) return;
  const empty =
    !getMany(holder, 'dataInputs').length &&
    !getMany(holder, 'dataOutputs').length &&
    [...getMany(holder, 'inputSets'), ...getMany(holder, 'outputSets')].every(
      (set) =>
        [...KEYS.input.refs, ...KEYS.output.refs, 'inputSetRefs', 'outputSetRefs'].every(
          (key) => !getMany(set, key).length,
        ) && !getRef(set, 'extensionElements'),
    ) &&
    !getRef(holder, 'extensionElements') &&
    !getMany(holder, 'documentation').length;
  if (empty) log.set(owner, 'ioSpecification', undefined);
}
