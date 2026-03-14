/**
 * CLI Command: memorix ingest
 *
 * Parent command for Git→Memory ingestion.
 */

import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'ingest',
    description: 'Ingest engineering knowledge from Git (commit → memory)',
  },
  subCommands: {
    commit: () => import('./ingest-commit.js').then(m => m.default),
    log: () => import('./ingest-log.js').then(m => m.default),
  },
});
