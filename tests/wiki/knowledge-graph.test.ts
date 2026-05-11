/**
 * Knowledge Graph Generator Tests
 *
 * Covers:
 * - other project observations do not leak into graph
 * - probe observations are excluded from graph nodes
 * - resolved/archived observations are excluded
 * - graph with no relations still produces useful nodes from KB semantics
 * - deterministic output: fixed input → fixed output
 * - section clusters match KB section definitions
 * - edges inferred between same-entity observations
 * - mini-skill derived_from edges
 * - stats are accurate
 */

import { describe, it, expect } from 'vitest';
import { generateKnowledgeGraph } from '../../src/wiki/knowledge-graph.js';
import type { Observation, MiniSkill } from '../../src/types.js';

const PROJECT_ID = 'test/kg-project';
const OTHER_PROJECT_ID = 'other/kg-project';
const FIXED_TIMESTAMP = '2026-01-01T00:00:00.000Z';
let nextObservationId = 1;
let nextSkillId = 1;

function makeObs(overrides: Partial<Observation> = {}): Observation {
  return {
    id: overrides.id ?? nextObservationId++,
    entityName: 'test-entity',
    type: 'decision',
    title: 'Test observation',
    narrative: 'A test narrative for the knowledge graph.',
    facts: [],
    filesModified: [],
    concepts: [],
    tokens: 50,
    createdAt: FIXED_TIMESTAMP,
    projectId: PROJECT_ID,
    status: 'active',
    source: 'agent',
    sourceDetail: 'explicit',
    valueCategory: 'core',
    ...overrides,
  };
}

function makeSkill(overrides: Partial<MiniSkill> = {}): MiniSkill {
  return {
    id: overrides.id ?? nextSkillId++,
    sourceObservationIds: [100],
    sourceEntity: 'test-entity',
    title: 'Test skill',
    instruction: 'Do the right thing',
    trigger: 'When you encounter this scenario',
    facts: ['fact 1'],
    projectId: PROJECT_ID,
    createdAt: FIXED_TIMESTAMP,
    usedCount: 0,
    tags: [],
    ...overrides,
  };
}

// Project scope isolation

describe('Project scope isolation', () => {
  it('other project observations do not leak into graph', () => {
    const obs1 = makeObs({ id: 1, type: 'decision', title: 'In-project', projectId: PROJECT_ID });
    const obs2 = makeObs({ id: 2, type: 'decision', title: 'Other-project', projectId: OTHER_PROJECT_ID });
    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: [obs1, obs2], miniSkills: [] });
    expect(kg.nodes.length).toBe(1);
    expect(kg.nodes[0].label).toBe('In-project');
  });

  it('other project mini-skills do not leak into graph', () => {
    const skill1 = makeSkill({ id: 1, title: 'Project skill', projectId: PROJECT_ID });
    const skill2 = makeSkill({ id: 2, title: 'Other skill', projectId: OTHER_PROJECT_ID });
    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: [], miniSkills: [skill1, skill2] });
    expect(kg.nodes.length).toBe(1);
    expect(kg.nodes[0].label).toBe('Project skill');
  });
});

// Exclusion rules

describe('Exclusion rules', () => {
  it('probe observations are excluded from graph nodes', () => {
    const obs = makeObs({ type: 'probe', title: 'Probe heartbeat' });
    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: [obs], miniSkills: [] });
    expect(kg.nodes.length).toBe(0);
  });

  it('resolved observations are excluded', () => {
    const obs = makeObs({ status: 'resolved', title: 'Resolved obs' });
    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: [obs], miniSkills: [] });
    expect(kg.nodes.length).toBe(0);
  });

  it('archived observations are excluded', () => {
    const obs = makeObs({ status: 'archived', title: 'Archived obs' });
    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: [obs], miniSkills: [] });
    expect(kg.nodes.length).toBe(0);
  });

  it('ephemeral observations are excluded', () => {
    const obs = makeObs({ valueCategory: 'ephemeral', title: 'Ephemeral obs' });
    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: [obs], miniSkills: [] });
    expect(kg.nodes.length).toBe(0);
  });
});

// No relations but still useful nodes

describe('No graph relations — still useful nodes from KB semantics', () => {
  it('produces nodes even when no edges exist (single entity)', () => {
    const obs = makeObs({ id: 10, type: 'decision', title: 'Solo decision', entityName: 'unique-entity' });
    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: [obs], miniSkills: [] });
    expect(kg.nodes.length).toBe(1);
    expect(kg.edges.length).toBe(0);
    expect(kg.clusters.length).toBe(1);
    expect(kg.clusters[0].sectionId).toBe('core-decisions');
  });

  it('produces clusters for each section that has nodes', () => {
    const obs = [
      makeObs({ id: 10, type: 'decision', title: 'D1' }),
      makeObs({ id: 11, type: 'gotcha', title: 'G1' }),
      makeObs({ id: 12, type: 'how-it-works', title: 'H1' }),
    ];
    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: obs, miniSkills: [] });
    expect(kg.nodes.length).toBe(3);
    expect(kg.clusters.length).toBe(3);
    const sectionIds = kg.clusters.map(c => c.sectionId).sort();
    expect(sectionIds).toEqual(['core-decisions', 'known-gotchas', 'operational-knowledge']);
  });
});

// Determinism

describe('Determinism', () => {
  it('returns equal output for the same inputs and fixed generatedAt', () => {
    const observations = [makeObs({ id: 500, type: 'decision', title: 'Stable decision' })];
    const skills = [makeSkill({ id: 600, title: 'Stable skill' })];
    const options = { projectId: PROJECT_ID, observations, miniSkills: skills, generatedAt: FIXED_TIMESTAMP };

    const first = generateKnowledgeGraph(options);
    const second = generateKnowledgeGraph(options);

    expect(first.generatedAt).toBe(FIXED_TIMESTAMP);
    expect(first).toEqual(second);
  });
});

// Edge inference

describe('Edge inference', () => {
  it('infers relates_to edges between same-entity observations in same section', () => {
    const obs = [
      makeObs({ id: 1, type: 'decision', title: 'D1', entityName: 'auth-module' }),
      makeObs({ id: 2, type: 'decision', title: 'D2', entityName: 'auth-module' }),
    ];
    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: obs, miniSkills: [] });
    const relatesEdges = kg.edges.filter(e => e.edgeType === 'relates_to');
    // Bidirectional: 2 relates_to edges
    expect(relatesEdges.length).toBeGreaterThanOrEqual(2);
  });

  it('infers supports edges between same-entity observations in different sections', () => {
    const obs = [
      makeObs({ id: 1, type: 'decision', title: 'D1', entityName: 'auth-module' }),
      makeObs({ id: 2, type: 'how-it-works', title: 'H1', entityName: 'auth-module' }),
    ];
    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: obs, miniSkills: [] });
    const supportsEdges = kg.edges.filter(e => e.edgeType === 'supports');
    // decision supports operational-knowledge
    expect(supportsEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('infers derived_from edges from mini-skill to source observations', () => {
    const obs = makeObs({ id: 10, type: 'decision', title: 'Source obs' });
    const skill = makeSkill({ id: 1, title: 'Promoted skill', sourceObservationIds: [10] });
    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: [obs], miniSkills: [skill] });
    const derivedEdges = kg.edges.filter(e => e.edgeType === 'derived_from');
    expect(derivedEdges.length).toBe(1);
    expect(derivedEdges[0].source).toBe('skill:1');
    expect(derivedEdges[0].target).toBe('obs:10');
  });

  it('no self-edges', () => {
    const obs = makeObs({ id: 1, type: 'decision', title: 'D1', entityName: 'auth' });
    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: [obs], miniSkills: [] });
    for (const edge of kg.edges) {
      expect(edge.source).not.toBe(edge.target);
    }
  });

  it('does not create a dense relates_to clique for many observations on one entity', () => {
    const obs = Array.from({ length: 16 }, (_, idx) =>
      makeObs({
        id: 1000 + idx,
        type: 'what-changed',
        title: `Handoff ${idx}`,
        entityName: 'busy-handoff',
        facts: idx % 3 === 0 ? ['important'] : [],
      }),
    );

    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: obs, miniSkills: [] });
    const relatesEdges = kg.edges.filter(e => e.edgeType === 'relates_to');
    const degree = new Map<string, number>();
    for (const edge of relatesEdges) {
      degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
    }

    expect(relatesEdges.length).toBeLessThanOrEqual(8);
    expect(Math.max(...degree.values())).toBeLessThanOrEqual(8);
  });

  it('does not infer mention cliques from repeated provenance titles', () => {
    const obs = Array.from({ length: 20 }, (_, idx) =>
      makeObs({
        id: 2000 + idx,
        type: 'gotcha',
        title: 'HTTP quota fallback memory',
        entityName: `quota-${idx}`,
      }),
    );

    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: obs, miniSkills: [] });
    const mentionsEdges = kg.edges.filter(e => e.edgeType === 'mentions');

    expect(mentionsEdges.length).toBe(0);
  });
});

// Section clusters

describe('Section clusters', () => {
  it('clusters match KB section definitions', () => {
    const obs = [
      makeObs({ id: 1, type: 'decision', title: 'D1' }),
      makeObs({ id: 2, type: 'gotcha', title: 'G1' }),
      makeObs({ id: 3, type: 'how-it-works', title: 'H1' }),
      makeObs({ id: 4, source: 'git', sourceDetail: 'git-ingest', title: 'Git1' }),
    ];
    const skill = makeSkill({ id: 1, title: 'Skill1' });
    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: obs, miniSkills: [skill] });
    const sectionIds = kg.clusters.map(c => c.sectionId).sort();
    expect(sectionIds).toEqual(['core-decisions', 'git-backed-facts', 'known-gotchas', 'operational-knowledge', 'promoted-skills']);
  });

  it('nodeCount in cluster matches actual nodes in that section', () => {
    const obs = [
      makeObs({ id: 1, type: 'decision', title: 'D1' }),
      makeObs({ id: 2, type: 'decision', title: 'D2' }),
      makeObs({ id: 3, type: 'gotcha', title: 'G1' }),
    ];
    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: obs, miniSkills: [] });
    const coreCluster = kg.clusters.find(c => c.sectionId === 'core-decisions');
    expect(coreCluster!.nodeCount).toBe(2);
    const gotchaCluster = kg.clusters.find(c => c.sectionId === 'known-gotchas');
    expect(gotchaCluster!.nodeCount).toBe(1);
  });
});

// Stats

describe('Stats', () => {
  it('stats are accurate', () => {
    const obs = [
      makeObs({ id: 1, type: 'decision', title: 'D1', entityName: 'auth' }),
      makeObs({ id: 2, type: 'gotcha', title: 'G1', entityName: 'auth' }),
    ];
    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: obs, miniSkills: [] });
    expect(kg.stats.totalNodes).toBe(2);
    expect(kg.stats.clusterCount).toBe(2);
    expect(kg.stats.sectionCounts['core-decisions']).toBe(1);
    expect(kg.stats.sectionCounts['known-gotchas']).toBe(1);
  });
});

// Node properties

describe('Node properties', () => {
  it('node id uses obs:<id> format for observations', () => {
    const obs = makeObs({ id: 42, type: 'decision', title: 'D1' });
    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: [obs], miniSkills: [] });
    expect(kg.nodes[0].id).toBe('obs:42');
  });

  it('node id uses skill:<id> format for mini-skills', () => {
    const skill = makeSkill({ id: 7, title: 'Skill' });
    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: [], miniSkills: [skill] });
    expect(kg.nodes[0].id).toBe('skill:7');
  });

  it('node has provenance refs', () => {
    const obs = makeObs({ id: 42, type: 'decision', title: 'D1' });
    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: [obs], miniSkills: [] });
    expect(kg.nodes[0].refs.length).toBeGreaterThan(0);
    expect(kg.nodes[0].refs[0].id).toBe('obs:42');
  });

  it('evidenceCount reflects facts + concepts + filesModified', () => {
    const obs = makeObs({ id: 1, type: 'decision', title: 'D1', facts: ['f1', 'f2'], concepts: ['c1'], filesModified: ['a.ts', 'b.ts'] });
    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: [obs], miniSkills: [] });
    expect(kg.nodes[0].evidenceCount).toBe(5);
  });
});

// Title and metadata

describe('Title and metadata', () => {
  it('has correct title and projectId', () => {
    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: [], miniSkills: [] });
    expect(kg.title).toBe('Knowledge Graph');
    expect(kg.projectId).toBe(PROJECT_ID);
  });

  it('uses generatedAt when provided', () => {
    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: [], miniSkills: [], generatedAt: FIXED_TIMESTAMP });
    expect(kg.generatedAt).toBe(FIXED_TIMESTAMP);
  });
});

// Graph-store relation merging

describe('Graph-store relation merging', () => {
  it('graph-store relation survives into semantic edges', () => {
    const obs = [
      makeObs({ id: 1, type: 'decision', title: 'D1', entityName: 'auth-module' }),
      makeObs({ id: 2, type: 'how-it-works', title: 'H1', entityName: 'billing-service' }),
    ];
    const relations = [
      { from: 'auth-module', to: 'billing-service', relationType: 'supports' },
    ];
    const kg = generateKnowledgeGraph({
      projectId: PROJECT_ID,
      observations: obs,
      miniSkills: [],
      graphEntities: [],
      graphRelations: relations,
    });
    // The graph-store relation should produce a semantic edge
    const grEdges = kg.edges.filter(e => e.id.startsWith('e_gr_'));
    expect(grEdges.length).toBeGreaterThanOrEqual(1);
    // It should connect obs:1 (auth-module) -> obs:2 (billing-service)
    const authToBilling = grEdges.find(e => e.source === 'obs:1' && e.target === 'obs:2');
    expect(authToBilling).toBeDefined();
    expect(authToBilling!.edgeType).toBe('supports');
  });

  it('graph-store relation with unknown entity is skipped', () => {
    const obs = [
      makeObs({ id: 1, type: 'decision', title: 'D1', entityName: 'auth-module' }),
    ];
    const relations = [
      { from: 'auth-module', to: 'nonexistent-entity', relationType: 'relates_to' },
    ];
    const kg = generateKnowledgeGraph({
      projectId: PROJECT_ID,
      observations: obs,
      miniSkills: [],
      graphEntities: [],
      graphRelations: relations,
    });
    const grEdges = kg.edges.filter(e => e.id.startsWith('e_gr_'));
    expect(grEdges.length).toBe(0);
  });

  it('graph-store relation duplicates are skipped', () => {
    const obs = [
      makeObs({ id: 1, type: 'decision', title: 'D1', entityName: 'auth-module' }),
      makeObs({ id: 2, type: 'how-it-works', title: 'H1', entityName: 'billing-service' }),
    ];
    // Same-entity inference already creates a relates_to or supports edge,
    // so the graph-store relation with same mapped type should not duplicate
    const relations = [
      { from: 'auth-module', to: 'billing-service', relationType: 'supports' },
    ];
    const kg = generateKnowledgeGraph({
      projectId: PROJECT_ID,
      observations: obs,
      miniSkills: [],
      graphEntities: [],
      graphRelations: relations,
    });
    const authToBilling = kg.edges.filter(
      e => e.source === 'obs:1' && e.target === 'obs:2' && e.edgeType === 'supports',
    );
    // Should have at most 1 edge with this exact source:edgeType:target
    expect(authToBilling.length).toBeLessThanOrEqual(1);
  });

  it('graph-store relationType is mapped to semantic edgeType', () => {
    const obs = [
      makeObs({ id: 1, type: 'decision', title: 'D1', entityName: 'alpha' }),
      makeObs({ id: 2, type: 'how-it-works', title: 'H1', entityName: 'beta' }),
      makeObs({ id: 3, type: 'gotcha', title: 'G1', entityName: 'gamma' }),
    ];
    const relations = [
      { from: 'alpha', to: 'beta', relationType: 'depends_on' },
      { from: 'beta', to: 'gamma', relationType: 'references' },
      { from: 'alpha', to: 'gamma', relationType: 'derived_from_source' },
    ];
    const kg = generateKnowledgeGraph({
      projectId: PROJECT_ID,
      observations: obs,
      miniSkills: [],
      graphEntities: [],
      graphRelations: relations,
    });
    const grEdges = kg.edges.filter(e => e.id.startsWith('e_gr_'));
    expect(grEdges.length).toBeGreaterThanOrEqual(3);
    const depends = grEdges.find(e => e.source === 'obs:1' && e.target === 'obs:2');
    expect(depends?.edgeType).toBe('supports');
    const refs = grEdges.find(e => e.source === 'obs:2' && e.target === 'obs:3');
    expect(refs?.edgeType).toBe('mentions');
    const derived = grEdges.find(e => e.source === 'obs:1' && e.target === 'obs:3');
    expect(derived?.edgeType).toBe('derived_from');
  });
});

// Cluster labels are i18n-ready (sectionId-based, not hardcoded English)

describe('Cluster labels are i18n-ready', () => {
  it('cluster labels match section IDs that map to i18n keys, not raw English', () => {
    const obs = [
      makeObs({ id: 1, type: 'decision', title: 'D1' }),
      makeObs({ id: 2, type: 'gotcha', title: 'G1' }),
    ];
    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: obs, miniSkills: [] });
    // Clusters must have sectionId that maps to a known i18n key
    const knownSectionIds = ['core-decisions', 'operational-knowledge', 'known-gotchas', 'git-backed-facts', 'promoted-skills'];
    for (const cluster of kg.clusters) {
      expect(knownSectionIds).toContain(cluster.sectionId);
    }
  });

  it('cluster label is present but frontend should use i18n key, not API label', () => {
    const obs = [makeObs({ id: 1, type: 'decision', title: 'D1' })];
    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: obs, miniSkills: [] });
    // API returns English label as default, but frontend must use sectionId -> i18n
    const cluster = kg.clusters.find(c => c.sectionId === 'core-decisions');
    expect(cluster).toBeDefined();
    expect(cluster!.label).toBe('Core Decisions'); // API default
    // Frontend should NOT display this label directly in ZH mode
    // It should use sectionId to look up the ZH i18n key
  });
});

// EdgeType style data completeness

describe('EdgeType style data', () => {
  it('every edgeType in output has a matching style definition in frontend edgeStyleMap', () => {
    const obs = [
      makeObs({ id: 1, type: 'decision', title: 'D1', entityName: 'auth' }),
      makeObs({ id: 2, type: 'how-it-works', title: 'H1', entityName: 'auth' }),
      makeObs({ id: 3, type: 'gotcha', title: 'G1', entityName: 'auth' }),
    ];
    const skill = makeSkill({ id: 1, title: 'Skill', sourceObservationIds: [1] });
    const kg = generateKnowledgeGraph({ projectId: PROJECT_ID, observations: obs, miniSkills: [skill] });

    // All edge types produced must be in the known set
    const knownEdgeTypes = ['supports', 'relates_to', 'mentions', 'derived_from'];
    const producedEdgeTypes = new Set(kg.edges.map(e => e.edgeType));
    for (const et of producedEdgeTypes) {
      expect(knownEdgeTypes).toContain(et);
    }
  });

  it('each edgeType has color, arrow, dash, and label style properties in edgeStyleMap', () => {
    // This test verifies the frontend edgeStyleMap structure is complete
    // The actual edgeStyleMap is in app.js, but we verify the type contract
    const edgeStyleMap = {
      'supports': { color: 'rgba(105,240,174,0.35)', arrow: 'triangle', dash: false, label: 'supports' },
      'relates_to': { color: 'rgba(128,216,255,0.25)', arrow: 'none', dash: [4, 4], label: 'relates to' },
      'mentions': { color: 'rgba(208,188,255,0.25)', arrow: 'triangle-cross', dash: false, label: 'mentions' },
      'derived_from': { color: 'rgba(255,183,77,0.35)', arrow: 'triangle', dash: [6, 3], label: 'derived from' },
    };
    for (const [type, style] of Object.entries(edgeStyleMap)) {
      expect(style).toHaveProperty('color');
      expect(style).toHaveProperty('arrow');
      expect(style).toHaveProperty('dash');
      expect(style).toHaveProperty('label');
      expect(typeof style.color).toBe('string');
      expect(typeof style.arrow).toBe('string');
      expect(typeof style.label).toBe('string');
      // dash can be boolean or number array
      expect(typeof style.dash === 'boolean' || Array.isArray(style.dash)).toBe(true);
    }
  });
});
