import { parse, stringify } from 'yaml';

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  content: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/** Parse the small YAML front-matter surface Memorix consumes. */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(raw);
  if (!opening) return { data: {}, content: raw };

  const afterOpening = opening[0].length;
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(raw.slice(afterOpening));
  if (!closing) return { data: {}, content: raw };

  const headerEnd = afterOpening + closing.index;
  const contentStart = headerEnd + closing[0].length;
  return {
    data: asRecord(parse(raw.slice(afterOpening, headerEnd))),
    content: raw.slice(contentStart),
  };
}

export function stringifyFrontmatter(content: string, data: Record<string, unknown>): string {
  return `---\n${stringify(data).trimEnd()}\n---\n${content}`;
}

type Matter = ((raw: string) => ParsedFrontmatter) & {
  stringify: typeof stringifyFrontmatter;
};

const matter: Matter = Object.assign(parseFrontmatter, { stringify: stringifyFrontmatter });

export default matter;
