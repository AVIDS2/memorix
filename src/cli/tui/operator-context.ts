import { initTeamStore } from '../../team/team-store.js';
import { loadCliIdentity, resolveCliIdentity } from '../identity.js';
import { getCliInvocation } from '../invocation.js';
import type { CliProjectContext } from '../commands/operator-shared.js';

export type TuiOperatorContext = Omit<CliProjectContext, 'teamStore'>;

/**
 * The Ink workbench is another CLI entry point, not an alternate security
 * model. It uses the same identity resolver, but avoids opening coordination
 * state until an actor was explicitly selected.
 */
export async function getTuiOperatorContext(): Promise<TuiOperatorContext> {
  const invocation = getCliInvocation();
  const { detectProject } = await import('../../project/detector.js');
  const project = detectProject(
    invocation.projectRoot
      ?? process.env.MEMORIX_PROJECT_ROOT
      ?? process.cwd(),
  );
  if (!project) throw new Error('No git repository found in the current directory.');

  const { getProjectDataDir } = await import('../../store/persistence.js');
  const dataDir = await getProjectDataDir(project.id);
  try {
    const { MaintenanceTargetStore } = await import('../../runtime/maintenance-targets.js');
    new MaintenanceTargetStore(dataDir).register({
      projectId: project.id,
      projectRoot: project.rootPath,
      dataDir,
    });
  } catch {
    // Workbench reads remain available when optional maintenance metadata fails.
  }

  const savedIdentity = await loadCliIdentity(dataDir, project.id);
  if (!invocation.actorId && !savedIdentity) {
    return {
      project,
      dataDir,
      reader: { projectId: project.id },
      identity: null,
    };
  }

  const teamStore = await initTeamStore(dataDir);
  const resolved = await resolveCliIdentity({
    project,
    dataDir,
    teamStore,
    explicitActorId: invocation.actorId,
  });
  return {
    project,
    dataDir,
    reader: resolved.reader,
    identity: resolved.identity,
    ...(resolved.warning ? { identityWarning: resolved.warning } : {}),
  };
}
