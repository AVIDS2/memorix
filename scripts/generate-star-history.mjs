#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GITHUB_API = 'https://api.github.com';
const PAGE_SIZE = 100;
const MAX_RETRIES = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REPOSITORY = 'AVIDS2/memorix';
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, '..');

const THEMES = {
  light: {
    background: '#ffffff',
    text: '#182230',
    muted: '#65758b',
    grid: '#d9e1ea',
    line: '#147d64',
    fill: '#147d64',
    accent: '#0d5f4f',
  },
  dark: {
    background: '#0d1117',
    text: '#e6edf3',
    muted: '#9ba8b7',
    grid: '#30363d',
    line: '#3dd6ae',
    fill: '#3dd6ae',
    accent: '#b9f7e5',
  },
};

function usage() {
  return [
    'Usage: node scripts/generate-star-history.mjs [options]',
    '',
    'Options:',
    `  --repo <owner/name>  Repository to chart (default: ${DEFAULT_REPOSITORY})`,
    '  --out-dir <path>     Asset directory (default: assets)',
    '  --help               Show this help message',
  ].join('\n');
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    repository: DEFAULT_REPOSITORY,
    outputDirectory: resolve(REPOSITORY_ROOT, 'assets'),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') {
      options.help = true;
    } else if (arg === '--repo') {
      options.repository = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === '--out-dir') {
      options.outputDirectory = resolve(process.cwd(), requireValue(argv, index, arg));
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository)) {
    throw new Error('--repo must use the owner/name format.');
  }

  return options;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function getToken() {
  return process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || undefined;
}

async function fetchPage(url, headers, fetchImpl) {
  let lastError;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetchImpl(url, { headers });
      if (response.ok) {
        return response;
      }

      const detail = (await response.text()).slice(0, 300);
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_RETRIES - 1) {
        throw new Error(`GitHub API returned ${response.status}: ${detail}`);
      }
      lastError = new Error(`GitHub API returned ${response.status}: ${detail}`);
    } catch (error) {
      if (attempt === MAX_RETRIES - 1) {
        throw error;
      }
      lastError = error;
    }

    await sleep(2 ** attempt * 1_000);
  }

  throw lastError ?? new Error('Unable to fetch GitHub stargazers.');
}

export function normalizeStarredAt(values) {
  return values
    .map((value) => {
      const parsed = Date.parse(value);
      if (Number.isNaN(parsed)) {
        throw new Error(`Invalid stargazer timestamp: ${value}`);
      }
      return new Date(parsed).toISOString();
    })
    .sort();
}

export async function fetchStargazerTimestamps(repository, {
  token = getToken(),
  fetchImpl = fetch,
} = {}) {
  const headers = {
    Accept: 'application/vnd.github.star+json',
    'User-Agent': 'memorix-star-history-generator',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else {
    console.warn('[star-history] No GitHub token found; public API requests are rate-limited.');
  }

  const timestamps = [];
  for (let page = 1; ; page += 1) {
    const endpoint = new URL(`/repos/${repository}/stargazers`, GITHUB_API);
    endpoint.searchParams.set('per_page', String(PAGE_SIZE));
    endpoint.searchParams.set('page', String(page));

    const response = await fetchPage(endpoint, headers, fetchImpl);
    const entries = await response.json();
    if (!Array.isArray(entries)) {
      throw new Error('GitHub returned an unexpected stargazer response.');
    }

    for (const entry of entries) {
      if (typeof entry?.starred_at !== 'string') {
        throw new Error('GitHub did not return stargazer timestamps.');
      }
      timestamps.push(entry.starred_at);
    }

    if (entries.length < PAGE_SIZE) {
      break;
    }
  }

  return normalizeStarredAt(timestamps);
}

export function createHistoryDocument(repository, starredAt) {
  return {
    schemaVersion: 1,
    repository,
    starredAt: normalizeStarredAt(starredAt),
  };
}

export function buildSeries(starredAt) {
  const timestamps = normalizeStarredAt(starredAt);
  if (timestamps.length === 0) {
    return [{ at: new Date('2000-01-01T00:00:00.000Z'), value: 0 }];
  }

  return timestamps.map((timestamp, index) => ({
    at: new Date(timestamp),
    value: index + 1,
  }));
}

function number(value) {
  return Number(value.toFixed(2));
}

function escapeXml(value) {
  return value.replace(/[<>&"']/g, (character) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&apos;',
  })[character]);
}

function formatCount(value) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`;
  }
  return String(value);
}

function formatFullCount(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatMonthYear(timestamp) {
  const date = new Date(timestamp);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function niceUpperBound(value) {
  const safeValue = Math.max(value, 1);
  const magnitude = 10 ** Math.floor(Math.log10(safeValue));
  return Math.ceil((safeValue * 1.12) / magnitude) * magnitude;
}

function buildPath(points) {
  return points.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${number(x)} ${number(y)}`).join(' ');
}

export function renderStarHistorySvg({ repository, starredAt, themeName }) {
  const theme = THEMES[themeName];
  if (!theme) {
    throw new Error(`Unknown theme: ${themeName}`);
  }

  const width = 1200;
  const height = 560;
  const margin = { top: 112, right: 48, bottom: 74, left: 76 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const series = buildSeries(starredAt);
  const maxValue = series.at(-1)?.value ?? 0;
  const firstTimestamp = series[0].at.getTime();
  const lastTimestamp = series.at(-1)?.at.getTime() ?? firstTimestamp;
  const paddedSpan = Math.max(lastTimestamp - firstTimestamp, DAY_MS * 30);
  const xMin = firstTimestamp - paddedSpan * 0.04;
  const xMax = lastTimestamp + paddedSpan * 0.04;
  const yMax = niceUpperBound(maxValue);
  const xFor = (timestamp) => margin.left + ((timestamp - xMin) / (xMax - xMin)) * chartWidth;
  const yFor = (value) => margin.top + chartHeight - (value / yMax) * chartHeight;
  const points = series.map(({ at, value }) => ({ x: xFor(at.getTime()), y: yFor(value) }));
  const linePath = buildPath(points);
  const firstPoint = points[0];
  const lastPoint = points.at(-1);
  const areaPath = `${linePath} L ${number(lastPoint.x)} ${margin.top + chartHeight} L ${number(firstPoint.x)} ${margin.top + chartHeight} Z`;
  const xTicks = Array.from({ length: 5 }, (_, index) => xMin + ((xMax - xMin) * index) / 4);
  const yTicks = Array.from({ length: 5 }, (_, index) => (yMax * index) / 4);
  const gradientId = `star-history-fill-${themeName}`;
  const escapedRepository = escapeXml(repository);
  const accessibleTitle = `${repository} Star History`;

  const yGrid = yTicks.map((value) => {
    const y = yFor(value);
    return [
      `<line x1="${margin.left}" y1="${number(y)}" x2="${width - margin.right}" y2="${number(y)}" stroke="${theme.grid}" stroke-width="1" stroke-dasharray="5 6" />`,
      `<text x="${margin.left - 14}" y="${number(y + 4)}" text-anchor="end" fill="${theme.muted}" font-size="14">${formatCount(value)}</text>`,
    ].join('');
  }).join('\n    ');

  const xLabels = xTicks.map((timestamp) => (
    `<text x="${number(xFor(timestamp))}" y="${height - 30}" text-anchor="middle" fill="${theme.muted}" font-size="14">${formatMonthYear(timestamp)}</text>`
  )).join('\n    ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(accessibleTitle)}</title>
  <desc id="description">Cumulative GitHub stars for ${escapedRepository}, generated from GitHub stargazer events.</desc>
  <defs>
    <linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${theme.fill}" stop-opacity="0.35" />
      <stop offset="100%" stop-color="${theme.fill}" stop-opacity="0" />
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" rx="10" fill="${theme.background}" />
  <text x="${margin.left}" y="48" fill="${theme.text}" font-size="28" font-weight="700" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif">Star History</text>
  <text x="${margin.left}" y="78" fill="${theme.muted}" font-size="16" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif">${escapedRepository}</text>
  <text x="${width - margin.right}" y="56" text-anchor="end" fill="${theme.accent}" font-size="24" font-weight="700" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif">${formatFullCount(maxValue)} stars</text>
  <g font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif">
    ${yGrid}
    <path d="${areaPath}" fill="url(#${gradientId})" />
    <path d="${linePath}" fill="none" stroke="${theme.line}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="${number(lastPoint.x)}" cy="${number(lastPoint.y)}" r="6" fill="${theme.line}" stroke="${theme.background}" stroke-width="3" />
    ${xLabels}
  </g>
</svg>
`;
}

export async function generateStarHistory({ repository, outputDirectory, token, fetchImpl }) {
  const starredAt = await fetchStargazerTimestamps(repository, { token, fetchImpl });
  const history = createHistoryDocument(repository, starredAt);
  await mkdir(outputDirectory, { recursive: true });

  await Promise.all([
    writeFile(resolve(outputDirectory, 'star-history.json'), `${JSON.stringify(history, null, 2)}\n`),
    writeFile(resolve(outputDirectory, 'star-history-light.svg'), renderStarHistorySvg({ repository, starredAt, themeName: 'light' })),
    writeFile(resolve(outputDirectory, 'star-history-dark.svg'), renderStarHistorySvg({ repository, starredAt, themeName: 'dark' })),
  ]);

  return { repository, count: starredAt.length, outputDirectory };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const result = await generateStarHistory(options);
  console.log(`[star-history] Wrote ${result.count} stargazer events to ${result.outputDirectory}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[star-history] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
