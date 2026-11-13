/** Experimental soy.webmcp/1, local draft 2026-11-13. Not an accepted NAP. */
export const WEBMCP_PROFILE = 'soy.webmcp/1';
export const TOOL_JSON_BYTES = 256 * 1024;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Schema = {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  enum?: Json[];
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  uniqueItems?: boolean;
};
export type ToolDescriptor = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Schema;
  outputSchema?: Schema;
  readOnly?: boolean;
};
export type Consumer = 'shell' | 'browser';
export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}
export function json(value: unknown, bytes = TOOL_JSON_BYTES): Json {
  let nodes = 0;
  function visit(v: unknown, depth: number): void {
    if (++nodes > 50000 || depth > 32)
      throw new ToolError('invalid-data', 'JSON is too deeply nested or complex.');
    if (
      v === null ||
      typeof v === 'boolean' ||
      typeof v === 'string' ||
      (typeof v === 'number' && Number.isFinite(v))
    )
      return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1);
      return;
    }
    if (typeof v === 'object' && v && Object.getPrototypeOf(v) === Object.prototype) {
      for (const [key, item] of Object.entries(v)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key))
          throw new ToolError('invalid-data', 'Unsafe object key.');
        visit(item, depth + 1);
      }
      return;
    }
    throw new ToolError('invalid-data', 'Only finite JSON values are accepted.');
  }
  visit(value, 0);
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).length > bytes)
    throw new ToolError('quota-exceeded', `JSON exceeds ${bytes} bytes.`);
  return JSON.parse(text) as Json;
}
const keys = new Set([
  'type',
  'description',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'uniqueItems',
]);
export function schema(value: unknown, depth = 0): Schema {
  const s = value as Schema;
  if (
    depth > 12 ||
    !s ||
    typeof s !== 'object' ||
    Array.isArray(s) ||
    Object.keys(s).some((k) => !keys.has(k)) ||
    !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(s.type)
  )
    throw new ToolError(
      'invalid-schema',
      'Unsupported schema. Use the documented bounded JSON Schema subset; no references or remote schemas.',
    );
  if (
    s.description !== undefined &&
    (typeof s.description !== 'string' || s.description.length > 2000)
  )
    throw new ToolError('invalid-schema', 'Invalid schema description.');
  for (const key of [
    'minimum',
    'maximum',
    'minItems',
    'maxItems',
    'minLength',
    'maxLength',
  ] as const)
    if (
      s[key] !== undefined &&
      (!Number.isFinite(s[key]) ||
        ((key.includes('Items') || key.includes('Length')) &&
          (!Number.isInteger(s[key]) || s[key]! < 0)))
    )
      throw new ToolError('invalid-schema', 'Invalid schema bound.');
  for (const [min, max] of [
    ['minimum', 'maximum'],
    ['minItems', 'maxItems'],
    ['minLength', 'maxLength'],
  ] as const)
    if (s[min] !== undefined && s[max] !== undefined && s[min]! > s[max]!)
      throw new ToolError('invalid-schema', 'Reversed schema bounds.');
  if (s.properties !== undefined) {
    if (
      s.type !== 'object' ||
      !s.properties ||
      Array.isArray(s.properties) ||
      typeof s.properties !== 'object'
    )
      throw new ToolError('invalid-schema', 'Invalid properties.');
    Object.values(s.properties).forEach((v) => schema(v, depth + 1));
  }
  if (
    s.required !== undefined &&
    (!Array.isArray(s.required) ||
      s.required.some((k) => typeof k !== 'string' || !Object.hasOwn(s.properties ?? {}, k)))
  )
    throw new ToolError('invalid-schema', 'Required properties must be declared.');
  for (const k of ['additionalProperties', 'uniqueItems'] as const)
    if (s[k] !== undefined && typeof s[k] !== 'boolean')
      throw new ToolError('invalid-schema', 'Invalid schema flag.');
  if (s.items !== undefined) schema(s.items, depth + 1);
  if (s.enum !== undefined && (!Array.isArray(s.enum) || !s.enum.length || s.enum.length > 100))
    throw new ToolError('invalid-schema', 'Invalid enum.');
  return s;
}
export function validate(s: Schema, v: Json, path = 'input'): void {
  const fail = () => {
    throw new ToolError('invalid-arguments', `${path} does not match the tool schema.`);
  };
  const kind = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
  if (s.type === 'integer' ? !(typeof v === 'number' && Number.isInteger(v)) : s.type !== kind)
    fail();
  if (s.enum && !s.enum.some((item) => JSON.stringify(item) === JSON.stringify(v))) fail();
  if (
    typeof v === 'number' &&
    ((s.minimum !== undefined && v < s.minimum) || (s.maximum !== undefined && v > s.maximum))
  )
    fail();
  if (
    typeof v === 'string' &&
    ((s.minLength !== undefined && v.length < s.minLength) ||
      (s.maxLength !== undefined && v.length > s.maxLength))
  )
    fail();
  if (Array.isArray(v)) {
    if (
      (s.minItems !== undefined && v.length < s.minItems) ||
      (s.maxItems !== undefined && v.length > s.maxItems) ||
      (s.uniqueItems && new Set(v.map((x) => JSON.stringify(x))).size !== v.length)
    )
      fail();
    if (s.items) v.forEach((item, i) => validate(s.items!, item, `${path}[${i}]`));
  } else if (v && typeof v === 'object') {
    if (s.required?.some((k) => !Object.hasOwn(v, k))) fail();
    for (const [k, item] of Object.entries(v)) {
      const child = s.properties?.[k];
      if (child) validate(child, item, `${path}.${k}`);
      else if (s.additionalProperties === false) fail();
    }
  }
}
export function descriptor(input: unknown): ToolDescriptor {
  const d = json(input, 16384) as unknown as ToolDescriptor;
  if (
    !d ||
    typeof d !== 'object' ||
    Array.isArray(d) ||
    Object.keys(d).some(
      (k) =>
        !['name', 'title', 'description', 'inputSchema', 'outputSchema', 'readOnly'].includes(k),
    ) ||
    typeof d.name !== 'string' ||
    !/^([a-z][a-z0-9_]{0,63})$/.test(d.name) ||
    typeof d.description !== 'string' ||
    !d.description.trim() ||
    d.description.length > 2000 ||
    (d.title !== undefined && (typeof d.title !== 'string' || d.title.length > 100)) ||
    (d.readOnly !== undefined && typeof d.readOnly !== 'boolean')
  )
    throw new ToolError('invalid-tool', 'Invalid tool descriptor.');
  schema(d.inputSchema);
  if (d.inputSchema.type !== 'object')
    throw new ToolError('invalid-schema', 'Tool arguments must be an object.');
  if (d.outputSchema) schema(d.outputSchema);
  return d;
}
