import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

function isMemorixPackageRoot(dir: string): boolean {
  const packageJsonPath = join(dir, 'package.json');
  if (!existsSync(packageJsonPath)) return false;

  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: unknown };
    return pkg.name === 'memorix';
  } catch {
    return false;
  }
}

export function findMemorixPackageRoot(startDir: string): string | undefined {
  let dir = resolve(startDir);

  for (let i = 0; i < 10; i++) {
    if (isMemorixPackageRoot(dir)) return dir;

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return undefined;
}

export function ensureMemorixPackageRoot(
  startDir: string = dirname(fileURLToPath(import.meta.url)),
): string | undefined {
  if (process.env.MEMORIX_PACKAGE_ROOT) {
    return process.env.MEMORIX_PACKAGE_ROOT;
  }

  const packageRoot = findMemorixPackageRoot(startDir);
  if (packageRoot) {
    process.env.MEMORIX_PACKAGE_ROOT = packageRoot;
  }

  return packageRoot;
}

function ensureBundledMemcodePackageDir(packageRoot: string): void {
  if (process.env.MEMCODE_PACKAGE_DIR || process.env.PI_PACKAGE_DIR) {
    return;
  }

  const bundledRuntimeDir = join(packageRoot, 'dist', 'memcode-runtime');
  if (existsSync(join(bundledRuntimeDir, 'package.json'))) {
    process.env.MEMCODE_PACKAGE_DIR = bundledRuntimeDir;
  }
}

export async function importBundledMemcode(
  startDir: string = dirname(fileURLToPath(import.meta.url)),
): Promise<{ runCli: (args: string[]) => Promise<void> | void }> {
  const packageRoot = ensureMemorixPackageRoot(startDir);
  if (packageRoot) {
    const bundledEntry = join(packageRoot, 'dist', 'memcode', 'index.js');
    if (existsSync(bundledEntry)) {
      ensureBundledMemcodePackageDir(packageRoot);
      return import(pathToFileURL(bundledEntry).href);
    }
  }

  // Source-checkout fallback for local development before the root dist exists.
  return import('@memorix/memcode');
}
