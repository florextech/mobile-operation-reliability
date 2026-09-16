import { integer, requireCondition } from './error.js';

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export interface PayloadLimits { readonly maxBytes: number; readonly maxDepth: number }

function utf8Width(point: number): number {
  if (point <= 0x7f) return 1;
  if (point <= 0x7ff) return 2;
  if (point <= 0xffff) return 3;
  return 4;
}

// UTF-16 code-unit ordering is stable across locales and runtimes.
function compareKeys(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Copies only plain JSON data, without invoking getters or toJSON. */
export function snapshotJson(value: unknown, limits: PayloadLimits): JsonValue {
  integer(limits.maxBytes, 'maxBytes', 1);
  integer(limits.maxDepth, 'maxDepth', 1);
  const ancestors = new Set<object>();
  const visit = (item: unknown, depth: number): JsonValue => {
    requireCondition(depth <= limits.maxDepth, 'InvalidInput', 'JSON nesting limit exceeded');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      requireCondition(Number.isFinite(item), 'InvalidInput', 'JSON numbers must be finite');
      return Object.is(item, -0) ? 0 : item;
    }
    requireCondition(typeof item === 'object', 'InvalidInput', 'Only JSON data is allowed');
    requireCondition(!ancestors.has(item), 'InvalidInput', 'Cyclic JSON data');
    ancestors.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    let result: JsonValue;
    if (Array.isArray(item)) {
      requireCondition(Reflect.ownKeys(item).length === item.length + 1, 'InvalidInput', 'Sparse or decorated arrays are not JSON snapshots');
      result = Array.from({ length: item.length }, (_, index) => {
        const descriptor = descriptors[String(index)];
        requireCondition(descriptor && 'value' in descriptor, 'InvalidInput', 'JSON accessors are forbidden');
        return visit(descriptor.value, depth + 1);
      });
    } else {
      const prototype: unknown = Object.getPrototypeOf(item);
      requireCondition(prototype === Object.prototype || prototype === null, 'InvalidInput', 'Only plain JSON objects are allowed');
      const entries = Reflect.ownKeys(item).map(key => {
        requireCondition(typeof key === 'string', 'InvalidInput', 'JSON symbol keys are forbidden');
        const descriptor = descriptors[key];
        requireCondition(descriptor && descriptor.enumerable && 'value' in descriptor, 'InvalidInput', 'JSON accessors and hidden fields are forbidden');
        return [key, visit(descriptor.value, depth + 1)] as const;
      });
      result = Object.fromEntries(entries);
    }
    ancestors.delete(item);
    return Object.freeze(result);
  };
  const snapshot = visit(value, 0);
  const encoded = JSON.stringify(snapshot);
  let bytes = 0;
  for (const character of encoded) {
    const point = character.codePointAt(0) ?? 0;
    bytes += utf8Width(point);
  }
  requireCondition(bytes <= limits.maxBytes, 'InvalidInput', 'JSON byte limit exceeded');
  return snapshot;
}

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as { readonly [key: string]: JsonValue };
  const entries = Object.keys(record).sort(compareKeys)
    .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key] ?? null)}`);
  return `{${entries.join(',')}}`;
}
