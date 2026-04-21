import { defineCommand } from 'citty';
import type { AgentTarget } from '../../types.js';
import { getObservationStore } from '../../store/obs-store.js';
import { emitError, emitResult, getCliProjectContext } from './operator-shared.js';

export default defineCommand({
  meta: {
    name: 'skills',
    description: 'Discover, generate, and inspect project skills from the CLI',
  },
  args: {
    name: { type: 'string', description: 'Skill name for "show"' },
    target: { type: 'string', description: 'Target agent for generated skills' },
    write: { type: 'boolean', description: 'Write generated skills to disk' },
    json: { type: 'boolean', description: 'Emit machine-readable JSON output' },
  },
  run: async ({ args }) => {
    const action = (args._ as string[])?.[0] || '';
    const asJson = !!args.json;

    try {
      const { project } = await getCliProjectContext();
      const { SkillsEngine } = await import('../../skills/engine.js');
      const engine = new SkillsEngine(project.rootPath);

      switch (action) {
        case 'list': {
          const skills = engine.listSkills();
          emitResult(
            { project, skills },
            skills.length === 0
              ? 'No skills found in project or global agent directories.'
              : skills.map((skill) => `- ${skill.name} (${skill.sourceAgent})`).join('\n'),
            asJson,
          );
          return;
        }

        case 'generate': {
          const observations = (await getObservationStore().loadAll())
            .filter((obs) => obs.projectId === project.id)
            .map((obs) => ({
              id: obs.id,
              entityName: obs.entityName,
              type: obs.type,
              title: obs.title,
              narrative: obs.narrative,
              facts: obs.facts,
              concepts: obs.concepts,
              filesModified: obs.filesModified,
              createdAt: obs.createdAt,
              status: obs.status,
              source: obs.source,
            }));
          const skills = engine.generateFromObservations(observations);
          const written: string[] = [];
          if (args.write && args.target) {
            for (const skill of skills) {
              const writtenPath = engine.writeSkill(skill, args.target as AgentTarget);
              if (writtenPath) written.push(writtenPath);
            }
          }
          emitResult(
            { project, skills, written },
            skills.length === 0
              ? 'No skill-worthy patterns found yet.'
              : skills.map((skill) => `- ${skill.name}: ${skill.description}`).join('\n'),
            asJson,
          );
          return;
        }

        case 'show': {
          const name = (args.name as string | undefined)?.trim();
          if (!name) {
            emitError('name is required for "memorix skills show"', asJson);
            return;
          }
          const direct = engine.injectSkill(name);
          if (direct) {
            emitResult({ project, skill: direct }, direct.content, asJson);
            return;
          }

          const observations = (await getObservationStore().loadAll())
            .filter((obs) => obs.projectId === project.id)
            .map((obs) => ({
              id: obs.id,
              entityName: obs.entityName,
              type: obs.type,
              title: obs.title,
              narrative: obs.narrative,
              facts: obs.facts,
              concepts: obs.concepts,
              filesModified: obs.filesModified,
              createdAt: obs.createdAt,
              status: obs.status,
              source: obs.source,
            }));
          const generated = engine.generateFromObservations(observations);
          const skill = generated.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
          if (!skill) {
            emitError(`Skill "${name}" not found`, asJson);
            return;
          }
          emitResult({ project, skill }, skill.content, asJson);
          return;
        }

        default:
          console.log('Memorix Skills Commands');
          console.log('');
          console.log('Usage:');
          console.log('  memorix skills list');
          console.log('  memorix skills generate [--write --target codex]');
          console.log('  memorix skills show --name <skill>');
      }
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error), asJson);
    }
  },
});

