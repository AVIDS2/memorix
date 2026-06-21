import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import { homedir } from 'node:os';
import {
  getGlobalConfigTomlPath,
  getProjectConfigTomlPath,
} from '../../config/config-paths.js';
import { detectProject } from '../../project/detector.js';

export default defineCommand({
  meta: {
    name: 'path',
    description: 'Show Memorix TOML config paths',
  },
  run: async () => {
    const project = detectProject(process.cwd());
    p.note([
      `Global:  ${getGlobalConfigTomlPath(homedir())}`,
      `Project: ${project ? getProjectConfigTomlPath(project.rootPath) : 'not inside a git project'}`,
    ].join('\n'), 'Memorix config');
  },
});
