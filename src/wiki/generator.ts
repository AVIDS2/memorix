import type { Observation, MiniSkill } from '../types.js';
import type { KnowledgeSourceRef, KnowledgeItem, KnowledgeSection, ProjectKnowledgeOverview } from './types.js';

const COMMAND_LOG_TITLE = /^(Ran:|Command:|Executed:)\s/i;

interface SectionDef {
  id: string;
  title: string;
  typeMatch: (o: Observation) => boolean;
}

const SECTION_DEFS: SectionDef[] = [
  {
    id: 'core-decisions',
    title: 'Core Decisions',
    typeMatch: (o) => o.type === 'decision' || o.type === 'trade-off' || o.type === 'reasoning',
  },
  {
    id: 'operational-knowledge',
    title: 'Operational Knowledge',
    typeMatch: (o) =>
      o.type === 'how-it-works' ||
      o.type === 'what-changed' ||
      o.type === 'why-it-exists' ||
      o.type === 'discovery' ||
      o.type === 'session-request',
  },
  {
    id: 'known-gotchas',
    title: 'Known Gotchas',
    typeMatch: (o) => o.type === 'gotcha' || o.type === 'problem-solution',
  },
];

function isExcludedType(o: Observation): boolean {
  return o.type === 'probe';
}

function isCommandLog(o: Observation): boolean {
  return COMMAND_LOG_TITLE.test(o.title || '');
}

function isInactive(o: Observation): boolean {
  const status = o.status ?? 'active';
  return status !== 'active';
}

function isOtherProject(o: Observation, projectId: string): boolean {
  return o.projectId !== projectId;
}

function contextualHasSubstance(o: Observation): boolean {
  if (o.valueCategory !== 'contextual') return true;
  const hasFacts = (o.facts?.length ?? 0) > 0;
  const hasConcepts = (o.concepts?.length ?? 0) > 0;
  const hasFiles = (o.filesModified?.length ?? 0) > 0;
  const hasEntity = !!(o.entityName && o.entityName !== 'quick-note' && o.entityName !== 'unknown');
  return hasFacts || hasConcepts || hasFiles || hasEntity;
}

function isEligible(o: Observation, projectId: string): boolean {
  if (isExcludedType(o)) return false;
  if (isCommandLog(o)) return false;
  if (isInactive(o)) return false;
  if (isOtherProject(o, projectId)) return false;
  if (o.valueCategory === 'ephemeral') return false;
  if (!contextualHasSubstance(o)) return false;
  return true;
}

function obsToItem(o: Observation): KnowledgeItem {
  const ref: KnowledgeSourceRef = {
    kind: o.source === 'git' ? 'git' : 'observation',
    id: `obs:${o.id}`,
    title: o.title,
  };
  return {
    title: o.title,
    summary: o.narrative?.slice(0, 200) || '',
    type: o.type,
    entityName: o.entityName || undefined,
    refs: [ref],
  };
}

function skillToItem(s: MiniSkill): KnowledgeItem {
  const ref: KnowledgeSourceRef = {
    kind: 'mini-skill',
    id: `skill:${s.id}`,
    title: s.title,
  };
  const obsRefs: KnowledgeSourceRef[] = s.sourceObservationIds.map(
    (oid) => ({ kind: 'observation' as const, id: `obs:${oid}` }),
  );
  return {
    title: s.title,
    summary: s.instruction?.slice(0, 200) || '',
    type: 'mini-skill',
    entityName: s.sourceEntity || undefined,
    refs: [ref, ...obsRefs],
  };
}

function buildGitSection(observations: Observation[]): KnowledgeSection {
  const gitObs = observations.filter(
    (o) => o.source === 'git' && o.sourceDetail === 'git-ingest',
  );
  const items = gitObs.map(obsToItem);
  return {
    id: 'git-backed-facts',
    title: 'Git-backed Facts',
    items,
    empty: items.length === 0,
  };
}

function buildSkillsSection(skills: MiniSkill[]): KnowledgeSection {
  const items = skills.map(skillToItem);
  return {
    id: 'promoted-skills',
    title: 'Promoted Skills',
    items,
    empty: items.length === 0,
  };
}

function buildProjectOverview(
  projectId: string,
  eligibleObs: Observation[],
  skills: MiniSkill[],
): KnowledgeSection {
  const refs: KnowledgeSourceRef[] = [
    ...eligibleObs.slice(0, 5).map((o) => ({
      kind: o.source === 'git' ? 'git' as const : 'observation' as const,
      id: `obs:${o.id}`,
      title: o.title,
    })),
    ...skills.slice(0, 5).map((s) => ({
      kind: 'mini-skill' as const,
      id: `skill:${s.id}`,
      title: s.title,
    })),
  ];

  if (refs.length === 0) {
    return {
      id: 'project-overview',
      title: 'Project Overview',
      items: [],
      empty: true,
    };
  }

  const lines: string[] = [];
  lines.push(`Project: ${projectId}`);
  lines.push(`Observations in KB: ${eligibleObs.length}`);
  lines.push(`Promoted skills: ${skills.length}`);

  const entityCounts = new Map<string, number>();
  for (const o of eligibleObs) {
    if (o.entityName) {
      entityCounts.set(o.entityName, (entityCounts.get(o.entityName) || 0) + 1);
    }
  }
  const topEntities = [...entityCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (topEntities.length > 0) {
    lines.push(`Top entities: ${topEntities.map(([name, count]) => `${name} (${count})`).join(', ')}`);
  }

  return {
    id: 'project-overview',
    title: 'Project Overview',
    items: [{
      title: projectId,
      summary: lines.join('\n'),
      type: 'overview',
      refs,
    }],
  };
}

export interface GenerateOptions {
  projectId: string;
  observations: Observation[];
  miniSkills: MiniSkill[];
  generatedAt?: string;
}

export function generateKnowledgeBase(options: GenerateOptions): ProjectKnowledgeOverview {
  const { projectId, observations, miniSkills } = options;

  const eligible = observations.filter((o) => isEligible(o, projectId));
  const scopedMiniSkills = miniSkills.filter(s => s.projectId === projectId);

  const typedSections: KnowledgeSection[] = SECTION_DEFS.map((def) => {
    const matched = eligible.filter(def.typeMatch);
    const items = matched.map(obsToItem);
    return {
      id: def.id,
      title: def.title,
      items,
      empty: items.length === 0,
    };
  });

  const projectOverview = buildProjectOverview(projectId, eligible, scopedMiniSkills);
  const gitSection = buildGitSection(eligible);
  const skillsSection = buildSkillsSection(scopedMiniSkills);

  const sections: KnowledgeSection[] = [
    projectOverview,
    ...typedSections,
    gitSection,
    skillsSection,
  ];

  const allRefs = sections.flatMap((s) => s.items.flatMap((i) => i.refs));
  const obsRefCount = allRefs.filter((r) => r.kind === 'observation' || r.kind === 'git').length;
  const skillRefCount = allRefs.filter((r) => r.kind === 'mini-skill').length;

  return {
    title: 'Knowledge Base',
    subtitle: 'LLM Wiki',
    projectId,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    sections,
    stats: {
      observationsUsed: eligible.length,
      miniSkillsUsed: scopedMiniSkills.length,
      refs: obsRefCount + skillRefCount,
    },
  };
}

export { isEligible, isExcludedType, isCommandLog, contextualHasSubstance };
