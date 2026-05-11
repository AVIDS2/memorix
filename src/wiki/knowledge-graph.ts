import type { Observation, MiniSkill } from '../types.js';
import type {
  KnowledgeSourceRef,
  SemanticNode,
  SemanticEdge,
  SemanticEdgeType,
  KnowledgeGraphCluster,
  KnowledgeGraphStats,
  ProjectKnowledgeGraph,
} from './types.js';
import { isEligible } from './generator.js';

// -- Section definitions (must match generator.ts SECTION_DEFS) --

interface SectionDef {
  id: string;
  label: string;
  typeMatch: (o: Observation) => boolean;
}

const SECTION_DEFS: SectionDef[] = [
  {
    id: 'core-decisions',
    label: 'Core Decisions',
    typeMatch: (o) => o.type === 'decision' || o.type === 'trade-off' || o.type === 'reasoning',
  },
  {
    id: 'operational-knowledge',
    label: 'Operational Knowledge',
    typeMatch: (o) =>
      o.type === 'how-it-works' ||
      o.type === 'what-changed' ||
      o.type === 'why-it-exists' ||
      o.type === 'discovery' ||
      o.type === 'session-request',
  },
  {
    id: 'known-gotchas',
    label: 'Known Gotchas',
    typeMatch: (o) => o.type === 'gotcha' || o.type === 'problem-solution',
  },
];

const GIT_SECTION: SectionDef = {
  id: 'git-backed-facts',
  label: 'Git-backed Facts',
  typeMatch: (o) => o.source === 'git' && o.sourceDetail === 'git-ingest',
};

const SKILLS_SECTION: SectionDef = {
  id: 'promoted-skills',
  label: 'Promoted Skills',
  typeMatch: () => false, // skills handled separately
};

const ALL_SECTIONS: SectionDef[] = [...SECTION_DEFS, GIT_SECTION, SKILLS_SECTION];

// -- Edge inference rules --
// Infer semantic edges between observations based on shared attributes.
// Rules (no LLM, deterministic):
// 1. supports: same entityName, different section -> source supports target
// 2. relates_to: same entityName, same section -> bidirectional
// 3. derived_from: mini-skill source obs -> skill node
// Explicit graph-store references are merged later as mentions edges.

function inferEdges(
  nodes: SemanticNode[],
  entityNameIndex: Map<string, SemanticNode[]>,
): SemanticEdge[] {
  const edges: SemanticEdge[] = [];
  const seen = new Set<string>();
  const maxRelatesEdgesPerEntitySection = 8;

  function addEdge(source: string, target: string, edgeType: SemanticEdgeType): void {
    const key = `${source}:${edgeType}:${target}`;
    if (seen.has(key)) return;
    if (source === target) return;
    seen.add(key);
    edges.push({
      id: `e_${edges.length}_${source}_${target}`,
      source,
      target,
      edgeType,
    });
  }

  function rankNodesForEntity(a: SemanticNode, b: SemanticNode): number {
    const evidenceDiff = (b.evidenceCount || 0) - (a.evidenceCount || 0);
    if (evidenceDiff !== 0) return evidenceDiff;
    return a.id.localeCompare(b.id);
  }

  // 1 & 2: Entity-name based edges
  for (const [, group] of entityNameIndex) {
    if (group.length < 2) continue;

    const bySection = new Map<string, SemanticNode[]>();
    for (const node of group) {
      const sectionGroup = bySection.get(node.sectionId) || [];
      sectionGroup.push(node);
      bySection.set(node.sectionId, sectionGroup);
    }

    for (const sectionGroup of bySection.values()) {
      const ranked = [...sectionGroup].sort(rankNodesForEntity);
      if (ranked.length === 2) {
        addEdge(ranked[0].id, ranked[1].id, 'relates_to');
        addEdge(ranked[1].id, ranked[0].id, 'relates_to');
        continue;
      }
      const anchor = ranked[0];
      for (const node of ranked.slice(1, maxRelatesEdgesPerEntitySection + 1)) {
        addEdge(anchor.id, node.id, 'relates_to');
      }
    }

    const sectionAnchors = [...bySection.entries()]
      .map(([sectionId, sectionGroup]) => ({
        sectionId,
        anchor: [...sectionGroup].sort(rankNodesForEntity)[0],
      }))
      .sort((a, b) => sectionPriority(a.sectionId) - sectionPriority(b.sectionId));

    for (let i = 0; i < sectionAnchors.length; i++) {
      for (let j = i + 1; j < sectionAnchors.length; j++) {
        const from = sectionAnchors[i].anchor;
        const to = sectionAnchors[j].anchor;
        const edgeType = sectionPriority(sectionAnchors[i].sectionId) === sectionPriority(sectionAnchors[j].sectionId)
          ? 'relates_to'
          : 'supports';
        addEdge(from.id, to.id, edgeType);
      }
    }
  }

  return edges;
}

function sectionPriority(sectionId: string): number {
  const order = ['core-decisions', 'known-gotchas', 'operational-knowledge', 'git-backed-facts', 'promoted-skills'];
  const idx = order.indexOf(sectionId);
  return idx >= 0 ? idx : order.length;
}

function sectionIdForObs(o: Observation): string {
  // Git-backed facts take priority over type-based sections
  if (GIT_SECTION.typeMatch(o)) return GIT_SECTION.id;
  for (const def of SECTION_DEFS) {
    if (def.typeMatch(o)) return def.id;
  }
  return 'operational-knowledge'; // fallback
}

// -- Graph store entity/relation types --

export interface GraphStoreEntity {
  name: string;
  entityType: string;
  observations: string[];
}

export interface GraphStoreRelation {
  from: string;
  to: string;
  relationType: string;
}

// Map graph-store relationType to SemanticEdgeType
function mapRelationType(relationType: string): SemanticEdgeType {
  const lower = relationType.toLowerCase();
  if (lower.includes('support') || lower.includes('depend')) return 'supports';
  if (lower.includes('relat') || lower.includes('connect') || lower.includes('associat')) return 'relates_to';
  if (lower.includes('mention') || lower.includes('refer')) return 'mentions';
  if (lower.includes('deriv') || lower.includes('origin') || lower.includes('source')) return 'derived_from';
  return 'relates_to'; // default fallback
}

// -- Main generator --

export interface GenerateGraphOptions {
  projectId: string;
  observations: Observation[];
  miniSkills: MiniSkill[];
  generatedAt?: string;
  graphEntities?: GraphStoreEntity[];
  graphRelations?: GraphStoreRelation[];
}

export function generateKnowledgeGraph(options: GenerateGraphOptions): ProjectKnowledgeGraph {
  const { projectId, observations, miniSkills, graphEntities, graphRelations } = options;

  const eligible = observations.filter((o) => isEligible(o, projectId));
  const scopedMiniSkills = miniSkills.filter((s) => s.projectId === projectId);

  // Build nodes from eligible observations
  const nodes: SemanticNode[] = [];
  const entityNameIndex = new Map<string, SemanticNode[]>();

  for (const o of eligible) {
    const sectionId = sectionIdForObs(o);
    const ref: KnowledgeSourceRef = {
      kind: o.source === 'git' ? 'git' : 'observation',
      id: `obs:${o.id}`,
      title: o.title,
    };
    const node: SemanticNode = {
      id: `obs:${o.id}`,
      label: o.title,
      nodeType: o.type,
      sectionId,
      entityName: o.entityName || undefined,
      evidenceCount: (o.facts?.length ?? 0) + (o.concepts?.length ?? 0) + (o.filesModified?.length ?? 0),
      summary: o.narrative?.slice(0, 200) || '',
      refs: [ref],
    };
    nodes.push(node);

    if (o.entityName) {
      const group = entityNameIndex.get(o.entityName) || [];
      group.push(node);
      entityNameIndex.set(o.entityName, group);
    }
  }

  // Build nodes from mini-skills
  for (const s of scopedMiniSkills) {
    const ref: KnowledgeSourceRef = {
      kind: 'mini-skill',
      id: `skill:${s.id}`,
      title: s.title,
    };
    const obsRefs: KnowledgeSourceRef[] = s.sourceObservationIds.map(
      (oid) => ({ kind: 'observation' as const, id: `obs:${oid}` }),
    );
    const node: SemanticNode = {
      id: `skill:${s.id}`,
      label: s.title,
      nodeType: 'mini-skill',
      sectionId: 'promoted-skills',
      entityName: s.sourceEntity || undefined,
      evidenceCount: obsRefs.length,
      summary: s.instruction?.slice(0, 200) || '',
      refs: [ref, ...obsRefs],
    };
    nodes.push(node);

    if (s.sourceEntity) {
      const group = entityNameIndex.get(s.sourceEntity) || [];
      group.push(node);
      entityNameIndex.set(s.sourceEntity, group);
    }
  }

  // Infer edges from observation/skill semantics
  const edges = inferEdges(nodes, entityNameIndex);

  // Add derived_from edges: skill -> source obs
  for (const s of scopedMiniSkills) {
    const skillNodeId = `skill:${s.id}`;
    for (const oid of s.sourceObservationIds) {
      const obsNodeId = `obs:${oid}`;
      if (nodes.some((n) => n.id === obsNodeId)) {
        edges.push({
          id: `e_${edges.length}_${skillNodeId}_${obsNodeId}`,
          source: skillNodeId,
          target: obsNodeId,
          edgeType: 'derived_from',
        });
      }
    }
  }

  // Merge graph-store relations into semantic edges
  // Only include relations where both endpoints map to existing nodes
  if (graphRelations && graphRelations.length > 0) {
    const entityNodeMap = new Map<string, string>(); // entityName -> first matching nodeId
    for (const n of nodes) {
      if (n.entityName && !entityNodeMap.has(n.entityName)) {
        entityNodeMap.set(n.entityName, n.id);
      }
    }

    const seen = new Set(edges.map((e) => `${e.source}:${e.edgeType}:${e.target}`));

    for (const rel of graphRelations) {
      const srcId = entityNodeMap.get(rel.from);
      const tgtId = entityNodeMap.get(rel.to);
      if (!srcId || !tgtId) continue; // skip if either endpoint not in project scope
      if (srcId === tgtId) continue;
      const edgeType = mapRelationType(rel.relationType);
      const key = `${srcId}:${edgeType}:${tgtId}`;
      if (seen.has(key)) continue; // skip duplicates
      seen.add(key);
      edges.push({
        id: `e_gr_${edges.length}_${srcId}_${tgtId}`,
        source: srcId,
        target: tgtId,
        edgeType,
      });
    }
  }

  // Build clusters from sections
  const sectionCounts: Record<string, number> = {};
  for (const n of nodes) {
    sectionCounts[n.sectionId] = (sectionCounts[n.sectionId] || 0) + 1;
  }

  const clusters: KnowledgeGraphCluster[] = ALL_SECTIONS
    .filter((def) => (sectionCounts[def.id] ?? 0) > 0)
    .map((def) => ({
      id: `cluster:${def.id}`,
      label: def.label,
      sectionId: def.id,
      nodeCount: sectionCounts[def.id] ?? 0,
    }));

  const stats: KnowledgeGraphStats = {
    totalNodes: nodes.length,
    totalEdges: edges.length,
    clusterCount: clusters.length,
    sectionCounts,
  };

  return {
    title: 'Knowledge Graph',
    projectId,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    nodes,
    edges,
    clusters,
    stats,
  };
}
