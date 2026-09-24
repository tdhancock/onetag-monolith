//
// target: __tests__/import-cycles.test.ts
//
// No runtime import cycles in app code.
//
// Metro evaluates a module the moment it is required, so a cycle hands one of
// its members a half-initialised module and the app dies on boot with
// "Cannot read property 'x' of undefined" — which then surfaces as every route
// "missing the required default export", because the route modules threw.
// ts-jest compiles re-exports to lazy getters, so the same cycle passes every
// other suite here. This one reads the import graph directly instead.
//
// Type-only imports are erased at compile time and cannot form a runtime
// cycle, so they are ignored.

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const ROOT = path.resolve(__dirname, '..');
const SOURCE_DIRS = ['app', 'components', 'features', 'lib', 'services', 'store', 'theme'];
const EXTENSIONS = ['.ts', '.tsx', '.native.ts', '.native.tsx'];

const listSources = (dir: string): string[] => {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];

  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSources(rel);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path.join(ROOT, rel)] : [];
  });
};

const resolve = (from: string, specifier: string): string | null => {
  // `@/` is the tsconfig path alias for the repo root.
  const base = specifier.startsWith('@/')
    ? path.join(ROOT, specifier.slice(2))
    : specifier.startsWith('.')
      ? path.resolve(path.dirname(from), specifier)
      : null;
  if (!base) return null;

  for (const candidate of [
    ...EXTENSIONS.map((ext) => base + ext),
    ...EXTENSIONS.map((ext) => path.join(base, 'index' + ext)),
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

/** Whether an import or export declaration survives compilation. */
const isRuntime = (node: ts.ImportDeclaration | ts.ExportDeclaration): boolean => {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return true; // side-effect import
    if (clause.isTypeOnly) return false;
    if (clause.name) return true;

    const bindings = clause.namedBindings;
    if (!bindings || ts.isNamespaceImport(bindings)) return true;
    return bindings.elements.some((element) => !element.isTypeOnly);
  }

  if (node.isTypeOnly) return false;
  const clause = node.exportClause;
  if (!clause || !ts.isNamedExports(clause)) return true; // export * from
  return clause.elements.some((element) => !element.isTypeOnly);
};

const runtimeImports = (file: string): string[] => {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const deps: string[] = [];

  for (const statement of source.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      isRuntime(statement)
    ) {
      const target = resolve(file, statement.moduleSpecifier.text);
      if (target) deps.push(target);
    }
  }
  return deps;
};

/** Every elementary cycle's members, one representative path per cycle. */
const findCycles = (graph: Map<string, string[]>): string[][] => {
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (node: string) => {
    state.set(node, 'visiting');
    stack.push(node);

    for (const next of graph.get(node) ?? []) {
      if (state.get(next) === 'visiting') {
        const cycle = stack.slice(stack.indexOf(next));
        const key = [...cycle].sort().join('|');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push([...cycle, next]);
        }
      } else if (!state.has(next)) {
        visit(next);
      }
    }

    stack.pop();
    state.set(node, 'done');
  };

  for (const node of graph.keys()) if (!state.has(node)) visit(node);
  return cycles;
};

describe('import graph', () => {
  it('has no runtime import cycles', () => {
    const files = [...SOURCE_DIRS.flatMap(listSources), path.join(ROOT, 'types.ts')];
    const graph = new Map(files.map((file) => [file, runtimeImports(file)]));

    const cycles = findCycles(graph).map((cycle) =>
      cycle.map((file) => path.relative(ROOT, file).replace(/\\/g, '/')).join(' → '),
    );

    expect(cycles).toEqual([]);
  });
});
