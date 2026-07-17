export interface KnowledgeSourceRef {
  kind: 'observation' | 'mini-skill' | 'git';
  id: string;
  title?: string;
}

export interface KnowledgeItem {
  title: string;
  summary: string;
  type: string;
  entityName?: string;
  refs: KnowledgeSourceRef[];
}

export interface KnowledgeSection {
  id: string;
  title: string;
  items: KnowledgeItem[];
  empty?: boolean;
}

export interface ProjectKnowledgeOverview {
  /**
   * A read-only projection of durable memories. This is intentionally not
   * called a maintained wiki until the 1.2 Knowledge Workspace exists.
   */
  title: 'Memory Overview';
  subtitle: 'Generated from durable project memory';
  kind: 'memory-overview';
  maintained: false;
  projectId: string;
  generatedAt: string;
  sections: KnowledgeSection[];
  stats: {
    observationsUsed: number;
    miniSkillsUsed: number;
    refs: number;
  };
}

// -- Deterministic memory-map types --

export type SemanticEdgeType = 'supports' | 'relates_to' | 'mentions' | 'derived_from';

export interface SemanticNode {
  id: string;
  label: string;
  /** Observation type or 'mini-skill' or 'section-cluster' */
  nodeType: string;
  /** Section this node belongs to (e.g. 'core-decisions') */
  sectionId: string;
  /** Entity name if applicable */
  entityName?: string;
  /** Number of provenance refs / evidence items */
  evidenceCount: number;
  /** Summary text (truncated) */
  summary: string;
  /** Source refs for inspector */
  refs: KnowledgeSourceRef[];
}

export interface SemanticEdge {
  id: string;
  source: string;
  target: string;
  edgeType: SemanticEdgeType;
}

export interface KnowledgeGraphCluster {
  id: string;
  label: string;
  sectionId: string;
  nodeCount: number;
}

export interface KnowledgeGraphStats {
  totalNodes: number;
  totalEdges: number;
  clusterCount: number;
  sectionCounts: Record<string, number>;
}

export interface ProjectKnowledgeGraph {
  /**
   * Deterministic links inferred from current memory data. It is not a
   * semantic graph database or a source of independently verified claims.
   */
  title: 'Memory Map';
  kind: 'deterministic-memory-map';
  semantic: false;
  projectId: string;
  generatedAt: string;
  nodes: SemanticNode[];
  edges: SemanticEdge[];
  clusters: KnowledgeGraphCluster[];
  stats: KnowledgeGraphStats;
}
