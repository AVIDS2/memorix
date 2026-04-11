/**
 * E2E test seed — creates a trivial task for orchestrator to dispatch.
 * Usage: npx tsx tests/orchestrate/e2e-seed.ts
 */

import { TeamStore } from '../../src/team/team-store.js';
import { getProjectDataDir } from '../../src/store/persistence.js';
import { detectProject } from '../../src/project/detector.js';

async function main() {
  const proj = detectProject(process.cwd());
  if (!proj) {
    console.error('Not a git repo');
    process.exit(1);
  }

  const dataDir = await getProjectDataDir(proj.id);
  const store = new TeamStore();
  await store.init(dataDir);

  // Create a trivial task
  const task = store.createTask({
    projectId: proj.id,
    description: 'Create a file called e2e-test-output.txt in the project root containing "Hello from autonomous agent". Exit when done (the orchestrator manages task state).',
  });

  console.log(`✅ Task created: ${task.task_id}`);
  console.log(`   Description: ${task.description}`);
  console.log(`   Project: ${proj.id}`);
  console.log(`   Data dir: ${dataDir}`);
  console.log(`\nNow run:`);
  console.log(`  npx tsx src/cli/index.ts orchestrate --agents claude --timeout 120000`);
}

main().catch(console.error);
