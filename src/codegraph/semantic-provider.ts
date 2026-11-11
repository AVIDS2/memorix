import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import ts from 'typescript';
import type { CodeEdge, CodeFile, CodeSymbol } from './types.js';
import { isCodeGraphExcludedPath } from './exclude.js';
import { makeCodeEdgeId, makeCodeFileId, makeCodeSymbolId, normalizeCodePath } from './ids.js';

const SEMANTIC_SOURCE = 'typescript-compiler' as const;
const SUPPORTED_LANGUAGES = new Set(['typescript', 'javascript']);

export interface SemanticIndexOptions {
  projectId: string;
  projectRoot: string;
  files: CodeFile[];
  exclude?: string[];
  /** Paths whose symbols/edges should be emitted; all files remain available to the checker. */
  includePaths?: string[];
}

export interface SemanticIndexResult {
  symbols: CodeSymbol[];
  edges: CodeEdge[];
  parsedFiles: number;
  parserErrors: number;
  unresolvedCalls: number;
  durationMs: number;
  diagnostics: Array<{ path: string; message: string }>;
}

interface SymbolRecord {
  node: ts.Declaration;
  symbol: CodeSymbol;
  checkerSymbol?: ts.Symbol;
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalPath(value: string): string {
  const normalized = resolve(value).replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isInside(root: string, candidate: string): boolean {
  const rootPath = canonicalPath(root).replace(/\/$/, '');
  const candidatePath = canonicalPath(candidate);
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}/`);
}

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (path.endsWith('.json')) return ts.ScriptKind.JSON;
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function isTestPath(path: string): boolean {
  return /(^|[/\\])__tests__([/\\])|(?:\.test|\.spec)\.[^.]+$/i.test(path);
}

function declarationName(node: ts.Node): string | undefined {
  const named = node as ts.Declaration & { name?: ts.PropertyName | ts.BindingName };
  const name = named.name;
  return name && ts.isIdentifier(name) ? name.text : undefined;
}

function symbolKind(node: ts.Declaration): CodeSymbol['kind'] | undefined {
  if (ts.isFunctionDeclaration(node)) return 'function';
  if (ts.isClassDeclaration(node)) return 'class';
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node) || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) return 'method';
  if (ts.isInterfaceDeclaration(node)) return 'interface';
  if (ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) return 'type';
  if (ts.isEnumMember(node)) return 'constant';
  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) return 'property';
  if (ts.isVariableDeclaration(node)) return node.initializer && (ts.isFunctionExpression(node.initializer) || ts.isArrowFunction(node.initializer))
    ? 'function'
    : 'constant';
  return undefined;
}

function isDeclarationNode(node: ts.Node): node is ts.Declaration {
  return Boolean(symbolKind(node as ts.Declaration) && declarationName(node));
}

function qualifiedName(node: ts.Declaration, name: string, ordinalByKey: Map<string, number>): string {
  const parts = [name];
  let parent: ts.Node | undefined = node.parent;
  while (parent && !ts.isSourceFile(parent)) {
    if (isDeclarationNode(parent)) {
      const parentName = declarationName(parent);
      if (parentName) parts.unshift(parentName);
    }
    parent = parent.parent;
  }
  const base = parts.join('::');
  const key = `${base}\n${symbolKind(node)}`;
  const ordinal = ordinalByKey.get(key) ?? 0;
  ordinalByKey.set(key, ordinal + 1);
  return ordinal === 0 ? base : `${base}#${ordinal + 1}`;
}

function lineAt(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function signatureFor(checker: ts.TypeChecker, node: ts.Declaration, sourceFile: ts.SourceFile): string | undefined {
  const signature = ts.isFunctionLike(node) ? checker.getSignatureFromDeclaration(node) : undefined;
  if (signature) {
    try {
      return checker.signatureToString(signature, node, ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope).slice(0, 240);
    } catch {
      // Broken or incomplete syntax should use the declaration text below.
    }
  }
  const text = sourceFile.text.slice(node.getStart(sourceFile), Math.min(node.end, node.getStart(sourceFile) + 240));
  return text.replace(/\s+/g, ' ').trim() || undefined;
}

function makeCompilerOptions(projectRoot: string): ts.CompilerOptions {
  const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, 'tsconfig.json');
  let options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    noEmit: true,
    noLib: true,
    skipLibCheck: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.Preserve,
    types: [],
  };
  if (configPath) {
    try {
      const config = ts.readConfigFile(configPath, ts.sys.readFile);
      if (!config.error) {
        const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, projectRoot);
        options = { ...options, ...parsed.options, noEmit: true, noLib: true, skipLibCheck: true, allowJs: true, checkJs: false, types: [] };
      }
    } catch {
      // A malformed project config must not disable the local fallback parser.
    }
  }
  return options;
}

function resolveLocalFile(
  projectRoot: string,
  filesByCanonicalPath: Map<string, CodeFile>,
  resolvedFileName: string | undefined,
): CodeFile | undefined {
  if (!resolvedFileName || !isInside(projectRoot, resolvedFileName)) return undefined;
  return filesByCanonicalPath.get(canonicalPath(resolvedFileName));
}

export function isSemanticLanguage(language: string | undefined): boolean {
  return Boolean(language && SUPPORTED_LANGUAGES.has(language));
}

export function buildTypeScriptSemanticIndex(input: SemanticIndexOptions): SemanticIndexResult {
  const started = Date.now();
  const semanticFiles = input.files.filter(file => isSemanticLanguage(file.language)
    && !isCodeGraphExcludedPath(file.path, input.exclude));
  if (semanticFiles.length === 0) {
    return { symbols: [], edges: [], parsedFiles: 0, parserErrors: 0, unresolvedCalls: 0, durationMs: Date.now() - started, diagnostics: [] };
  }

  const projectRoot = resolve(input.projectRoot);
  const filesByCanonicalPath = new Map(semanticFiles.map(file => [canonicalPath(resolve(projectRoot, file.path)), file]));
  const includePaths = input.includePaths
    ? new Set(input.includePaths.map(normalizeCodePath))
    : undefined;
  const includedFileIds = new Set(
    semanticFiles.filter(file => !includePaths || includePaths.has(normalizeCodePath(file.path))).map(file => file.id),
  );
  const rootNames = semanticFiles.map(file => resolve(projectRoot, file.path));
  const baseHost = ts.createCompilerHost(makeCompilerOptions(projectRoot), true);
  const compilerOptions = makeCompilerOptions(projectRoot);
  const host: ts.CompilerHost = {
    ...baseHost,
    getCurrentDirectory: () => projectRoot,
    fileExists: fileName => isInside(projectRoot, fileName) && baseHost.fileExists(fileName),
    readFile: fileName => isInside(projectRoot, fileName) ? baseHost.readFile(fileName) : undefined,
    realpath: fileName => fileName,
    getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
      if (!isInside(projectRoot, fileName)) return undefined;
      const text = baseHost.readFile(fileName);
      if (text === undefined) return undefined;
      return ts.createSourceFile(fileName, text, languageVersion, true, scriptKind(fileName));
    },
  };
  const program = ts.createProgram({ rootNames, options: compilerOptions, host });
  const checker = program.getTypeChecker();
  const symbols: CodeSymbol[] = [];
  const allSymbols: CodeSymbol[] = [];
  const declarationToRecord = new Map<ts.Node, SymbolRecord>();
  const checkerToRecord = new Map<ts.Symbol, SymbolRecord>();
  const declarationNameNodes = new Set<ts.Node>();
  const ordinalByKey = new Map<string, number>();
  const sourceFiles = program.getSourceFiles().filter(sourceFile => filesByCanonicalPath.has(canonicalPath(sourceFile.fileName)));

  for (const sourceFile of sourceFiles) {
    const file = filesByCanonicalPath.get(canonicalPath(sourceFile.fileName));
    if (!file) continue;
    const visitDeclarations = (node: ts.Node) => {
      if (isDeclarationNode(node)) {
        const name = declarationName(node);
        const kind = symbolKind(node);
        if (name && kind) {
          const qName = qualifiedName(node, name, ordinalByKey);
          const start = node.getStart(sourceFile);
          const symbol: CodeSymbol = {
            id: makeCodeSymbolId({ projectId: input.projectId, path: file.path, qualifiedName: qName, kind }),
            projectId: input.projectId,
            fileId: file.id || makeCodeFileId(input.projectId, file.path),
            path: file.path,
            name,
            qualifiedName: qName,
            kind,
            startLine: lineAt(sourceFile, start),
            endLine: lineAt(sourceFile, node.end),
            signature: signatureFor(checker, node, sourceFile),
            contentHash: hashText(sourceFile.text.slice(start, node.end)),
            indexedAt: new Date().toISOString(),
            source: SEMANTIC_SOURCE,
          };
          const namedNode = node as ts.Declaration & { name?: ts.Node };
          const checkerSymbol = namedNode.name ? checker.getSymbolAtLocation(namedNode.name) : undefined;
          const record = { node, symbol, ...(checkerSymbol ? { checkerSymbol } : {}) };
          allSymbols.push(symbol);
          if (!includePaths || includePaths.has(normalizeCodePath(file.path))) symbols.push(symbol);
          declarationToRecord.set(node, record);
          if (checkerSymbol) {
            checkerToRecord.set(checkerSymbol, record);
            for (const declaration of checkerSymbol.declarations ?? []) declarationToRecord.set(declaration, record);
          }
          if (namedNode.name) declarationNameNodes.add(namedNode.name);
        }
      }
      node.forEachChild(visitDeclarations);
    };
    visitDeclarations(sourceFile);
  }

  const edges = new Map<string, CodeEdge>();
  const addEdge = (inputEdge: Omit<CodeEdge, 'id' | 'projectId' | 'indexedAt' | 'source'>) => {
    const from = inputEdge.fromSymbolId ?? inputEdge.fromFileId ?? '';
    const to = inputEdge.toSymbolId ?? inputEdge.toFileId
      ?? (inputEdge.type === 'imports' && inputEdge.evidence ? `unresolved:${inputEdge.evidence}` : '');
    if (!from || !to) return;
    if (includePaths) {
      const endpointFileIds = new Set<string>();
      if (inputEdge.fromFileId) endpointFileIds.add(inputEdge.fromFileId);
      if (inputEdge.toFileId) endpointFileIds.add(inputEdge.toFileId);
      for (const symbol of allSymbols) {
        if (symbol.id === inputEdge.fromSymbolId || symbol.id === inputEdge.toSymbolId) endpointFileIds.add(symbol.fileId);
      }
      if (![...endpointFileIds].some(fileId => includedFileIds.has(fileId))) return;
    }
    const id = makeCodeEdgeId(input.projectId, from, inputEdge.type, to);
    if (edges.has(id)) return;
    edges.set(id, {
      ...inputEdge,
      id,
      projectId: input.projectId,
      indexedAt: new Date().toISOString(),
      source: SEMANTIC_SOURCE,
    });
  };
  const resolveRecord = (symbol: ts.Symbol | undefined): SymbolRecord | undefined => {
    if (!symbol) return undefined;
    let target = symbol;
    if (target.flags & ts.SymbolFlags.Alias) {
      try { target = checker.getAliasedSymbol(target); } catch { /* unresolved alias */ }
    }
    return checkerToRecord.get(target)
      ?? (target.declarations ?? []).map(declaration => declarationToRecord.get(declaration)).find(Boolean);
  };
  const currentRecord = (node: ts.Node): SymbolRecord | undefined => {
    let parent: ts.Node | undefined = node;
    while (parent) {
      const record = declarationToRecord.get(parent);
      if (record) return record;
      parent = parent.parent;
    }
    return undefined;
  };
  const fileForSource = (sourceFile: ts.SourceFile): CodeFile | undefined => filesByCanonicalPath.get(canonicalPath(sourceFile.fileName));
  const addFileRelation = (
    sourceFile: ts.SourceFile,
    target: CodeFile | undefined,
    type: CodeEdge['type'],
    node: ts.Node,
    evidence?: string,
  ) => {
    const source = fileForSource(sourceFile);
    if (!source || source.id === target?.id) return;
    addEdge({
      fromFileId: source.id,
      ...(target ? { toFileId: target.id } : {}),
      type,
      confidence: target ? 0.99 : 0.55,
      evidence: evidence ?? `${type} at line ${lineAt(sourceFile, node.getStart(sourceFile))}`,
    });
  };
  const moduleTarget = (sourceFile: ts.SourceFile, moduleName: string): CodeFile | undefined => {
    const resolvedModule = ts.resolveModuleName(moduleName, sourceFile.fileName, compilerOptions, host).resolvedModule;
    return resolveLocalFile(projectRoot, filesByCanonicalPath, resolvedModule?.resolvedFileName);
  };

  let unresolvedCalls = 0;
  for (const sourceFile of sourceFiles) {
    const file = fileForSource(sourceFile);
    if (!file) continue;
    const visit = (node: ts.Node) => {
      const owner = currentRecord(node);
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        addFileRelation(sourceFile, moduleTarget(sourceFile, node.moduleSpecifier.text), 'imports', node, `imports ${node.moduleSpecifier.text} at line ${lineAt(sourceFile, node.getStart(sourceFile))}`);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        addFileRelation(sourceFile, moduleTarget(sourceFile, node.moduleSpecifier.text), 'exports', node, `exports ${node.moduleSpecifier.text} at line ${lineAt(sourceFile, node.getStart(sourceFile))}`);
      } else if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const signature = checker.getResolvedSignature(node);
        const declarationNameNode = signature?.declaration
          ? (signature.declaration as ts.Declaration & { name?: ts.Node }).name
          : undefined;
        const target = resolveRecord(declarationNameNode ? checker.getSymbolAtLocation(declarationNameNode) : undefined)
          ?? (signature?.declaration ? declarationToRecord.get(signature.declaration) : undefined)
          ?? resolveRecord(checker.getSymbolAtLocation(node.expression));
        if (target) {
          const from = owner?.symbol.id;
          addEdge({
            ...(from ? { fromSymbolId: from } : { fromFileId: file.id }),
            toSymbolId: target.symbol.id,
            type: 'calls',
            confidence: 0.98,
            evidence: `resolved call at line ${lineAt(sourceFile, node.getStart(sourceFile))}`,
          });
          if (isTestPath(file.path)) {
            addEdge({
              ...(from ? { fromSymbolId: from } : { fromFileId: file.id }),
              toSymbolId: target.symbol.id,
              type: 'tests',
              confidence: 0.97,
              evidence: `resolved test call at line ${lineAt(sourceFile, node.getStart(sourceFile))}`,
            });
          }
        } else {
          unresolvedCalls++;
        }
      } else if (ts.isIdentifier(node) && !declarationNameNodes.has(node)
        && !ts.isImportSpecifier(node.parent) && !ts.isExportSpecifier(node.parent)) {
        const target = resolveRecord(checker.getSymbolAtLocation(node));
        if (target) {
          addEdge({
            ...(owner?.symbol.id ? { fromSymbolId: owner.symbol.id } : { fromFileId: file.id }),
            toSymbolId: target.symbol.id,
            type: 'references',
            confidence: 0.95,
            evidence: `resolved reference at line ${lineAt(sourceFile, node.getStart(sourceFile))}`,
          });
        }
      } else if (ts.isHeritageClause(node)) {
        const ownerRecord = currentRecord(node);
        for (const type of node.types) {
          const target = resolveRecord(checker.getSymbolAtLocation(type.expression));
          if (ownerRecord && target) {
            addEdge({
              fromSymbolId: ownerRecord.symbol.id,
              toSymbolId: target.symbol.id,
              type: node.token === ts.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements',
              confidence: 0.99,
              evidence: `compiler-resolved heritage at line ${lineAt(sourceFile, type.getStart(sourceFile))}`,
            });
          }
        }
      }
      node.forEachChild(visit);
    };
    visit(sourceFile);
  }

  const diagnostics = sourceFiles.flatMap(sourceFile => {
    const file = fileForSource(sourceFile);
    if (!file || (includePaths && !includePaths.has(normalizeCodePath(file.path)))) return [];
    return program.getSyntacticDiagnostics(sourceFile).slice(0, 4).map(diagnostic => ({
      path: file.path,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ').slice(0, 240),
    }));
  });

  return {
    symbols,
    edges: [...edges.values()],
    parsedFiles: sourceFiles.length,
    parserErrors: diagnostics.length,
    unresolvedCalls,
    durationMs: Date.now() - started,
    diagnostics,
  };
}
