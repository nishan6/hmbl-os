export type FieldChange = { from: unknown; to: unknown };
export type Changes = Record<string, FieldChange>;

const SENSITIVE = /pass(word)?|secret|token|hash/i;

function normalise(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (value === undefined) return null;
  return value;
}

/**
 * Field-level differences between two versions of a record. Only `fields` are
 * compared. Sensitive-looking fields are recorded as changed without values.
 * Returns null when nothing changed.
 */
export function diffChanges<T extends Record<string, unknown>>(
  before: Partial<T> | null,
  after: Partial<T> | null,
  fields: readonly (keyof T & string)[],
): Changes | null {
  const changes: Changes = {};
  for (const field of fields) {
    const from = normalise(before?.[field]);
    const to = normalise(after?.[field]);
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changes[field] = SENSITIVE.test(field)
      ? { from: "[redacted]", to: "[redacted]" }
      : { from, to };
  }
  return Object.keys(changes).length ? changes : null;
}
