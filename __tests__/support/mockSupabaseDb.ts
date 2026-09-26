// An in-memory stand-in for the parts of the Supabase client the product and
// project suites drive (ONE-40 onward): PostgREST's builder chain over plain
// tables, the few embeds those features select, and Storage uploads.
//
// It is deliberately small. Filters are `eq`, `in` and `ilike`; ordering is
// left to the code under test, which sorts what it needs. RLS is not modelled
// — each suite states what the database would return for the viewer it
// plays, and the policies themselves are pgTAP's to test (supabase/tests/).
//
// Use it from a suite's `jest.mock` factory:
//
//   jest.mock('../../../services/supabase.native', () =>
//     require('../../support/mockSupabaseDb').supabaseModule());
//   import { db } from '../../support/mockSupabaseDb';

type Row = Record<string, unknown>;

export interface MockDb {
  tables: Record<string, Row[]>;
  /** Every write, in order: which table, what kind, the payload and filters. */
  writes: { table: string; kind: string; payload: unknown; filters: Filter[] }[];
  /** Every read, in order: which table, what it selected, and whether it only counted. */
  reads: { table: string; select: string; head: boolean }[];
  /** Every Storage upload, by bucket and path. */
  uploads: { bucket: string; path: string }[];
  /** Every RPC call, by name and arguments. */
  rpcs: { name: string; args: unknown }[];
  /** RPC answers by function name. */
  rpcResults: Record<string, (args: Record<string, unknown>) => unknown>;
  /** Make the next request matching `table` and `kind` (a write, or `select`) fail with this error. */
  failNext: { table: string; kind: string; error: unknown } | null;
  /** Make every upload fail with this error. */
  failUploads: unknown;
  /** Resolve embeds for a table's selected rows. Suites add the ones they need. */
  embeds: Record<string, (row: Row, select: string) => Row>;
  /**
   * Which rows the viewer a suite plays may read, per table — standing in for
   * RLS on selects. A table with no entry is readable in full.
   */
  visible: Record<string, (row: Row) => boolean>;
}

type Filter = [op: 'eq' | 'in' | 'ilike' | 'not', column: string, value: unknown];

export const db: MockDb = {
  tables: {},
  writes: [],
  reads: [],
  uploads: [],
  rpcs: [],
  rpcResults: {},
  failNext: null,
  failUploads: null,
  embeds: {},
  visible: {},
};

let nextId = 1;

/** Empty every table and every log. Call from `beforeEach`. */
export const resetDb = (tables: Record<string, Row[]> = {}): void => {
  db.tables = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
  db.writes = [];
  db.reads = [];
  db.uploads = [];
  db.rpcs = [];
  db.rpcResults = {};
  db.failNext = null;
  db.failUploads = null;
  db.embeds = {};
  db.visible = {};
};

/** Whether the viewer may read a row, as `db.visible` says. */
export const canSee = (tableName: string, row: Row | null | undefined): boolean =>
  Boolean(row) && (db.visible[tableName]?.(row as Row) ?? true);

const table = (name: string): Row[] => (db.tables[name] ??= []);

// A filter on an embedded resource (`viewer_like.user_id`) narrows the embed,
// never the parent row, so it is not applied to rows here.
const matches = (row: Row, filters: Filter[]): boolean =>
  filters.every(([op, column, value]) => {
    if (column.includes('.')) return true;
    if (op === 'eq') return row[column] === value;
    if (op === 'in') return (value as unknown[]).includes(row[column]);
    if (op === 'not') return row[column] !== null && row[column] !== undefined;
    const pattern = String(value).replace(/%/g, '').toLowerCase();
    return String(row[column] ?? '').toLowerCase().includes(pattern);
  });

interface Op {
  kind: 'select' | 'insert' | 'update' | 'delete' | 'upsert';
  select: string;
  /** `select(…, { head: true })`: count the rows, return none. */
  head: boolean;
  payload: unknown;
  filters: Filter[];
  single: boolean;
  maybe: boolean;
  returning: boolean;
}

const run = (name: string, op: Op): { data: unknown; error: unknown } => {
  if (op.kind === 'select') db.reads.push({ table: name, select: op.select, head: op.head });
  else db.writes.push({ table: name, kind: op.kind, payload: op.payload, filters: op.filters });
  if (db.failNext && db.failNext.table === name && db.failNext.kind === op.kind) {
    const { error } = db.failNext;
    db.failNext = null;
    return { data: null, error };
  }

  let rows: Row[];
  if (op.kind === 'insert' || op.kind === 'upsert') {
    const payload = (Array.isArray(op.payload) ? op.payload : [op.payload]) as Row[];
    rows = payload.map((row) => ({ id: `${name}-${nextId++}`, ...row }));
    table(name).push(...rows);
  } else if (op.kind === 'update') {
    rows = table(name).filter((row) => matches(row, op.filters));
    rows.forEach((row) => Object.assign(row, op.payload));
  } else if (op.kind === 'delete') {
    rows = table(name).filter((row) => matches(row, op.filters));
    db.tables[name] = table(name).filter((row) => !rows.includes(row));
  } else {
    rows = table(name).filter((row) => matches(row, op.filters) && canSee(name, row));
  }

  if (op.kind !== 'select' && !op.returning) return { data: null, error: null };
  if (op.head) return { data: null, count: rows.length, error: null } as { data: unknown; error: unknown };

  const embed = db.embeds[name];
  const shaped = rows.map((row) => (embed ? embed(row, op.select) : { ...row }));
  if (op.single) return shaped.length === 1 ? { data: shaped[0], error: null } : { data: null, error: { message: 'not one row' } };
  if (op.maybe) return { data: shaped[0] ?? null, error: null };
  return { data: shaped, error: null };
};

const builder = (name: string) => {
  const op: Op = { kind: 'select', select: '*', head: false, payload: undefined, filters: [], single: false, maybe: false, returning: false };
  const chain: Record<string, unknown> = {
    select: (columns = '*', options?: { head?: boolean }) => {
      op.select = columns;
      op.head = options?.head === true;
      if (op.kind !== 'select') op.returning = true;
      return chain;
    },
    insert: (payload: unknown) => ((op.kind = 'insert'), (op.payload = payload), chain),
    upsert: (payload: unknown) => ((op.kind = 'upsert'), (op.payload = payload), chain),
    update: (payload: unknown) => ((op.kind = 'update'), (op.payload = payload), chain),
    delete: () => ((op.kind = 'delete'), chain),
    eq: (column: string, value: unknown) => (op.filters.push(['eq', column, value]), chain),
    in: (column: string, value: unknown[]) => (op.filters.push(['in', column, value]), chain),
    ilike: (column: string, value: string) => (op.filters.push(['ilike', column, value]), chain),
    not: (column: string) => (op.filters.push(['not', column, null]), chain),
    order: () => chain,
    limit: () => chain,
    range: () => chain,
    single: () => ((op.single = true), chain),
    maybeSingle: () => ((op.maybe = true), chain),
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve().then(() => run(name, op)).then(resolve, reject),
  };
  return chain;
};

/** What `jest.mock('…/services/supabase.native', …)` should return. */
export const supabaseModule = () => ({
  supabase: {
    from: (name: string) => builder(name),
    rpc: (name: string, args: Record<string, unknown>) => {
      db.rpcs.push({ name, args });
      const answer = db.rpcResults[name];
      return Promise.resolve({ data: answer ? answer(args) : null, error: null, status: 200 });
    },
    storage: {
      from: (bucket: string) => ({
        upload: (path: string) => {
          db.uploads.push({ bucket, path });
          return Promise.resolve({ error: db.failUploads ?? null });
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example/${bucket}/${path}` } }),
      }),
    },
  },
});
