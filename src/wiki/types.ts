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
  title: 'Knowledge Base';
  subtitle: 'LLM Wiki';
  projectId: string;
  generatedAt: string;
  sections: KnowledgeSection[];
  stats: {
    observationsUsed: number;
    miniSkillsUsed: number;
    refs: number;
  };
}
