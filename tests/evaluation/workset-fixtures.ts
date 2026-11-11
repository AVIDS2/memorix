import type { WorksetEvaluationFixture } from '../../src/evaluation/workset-evaluation.js';

export type WorksetFixtureEvidenceKind =
  | 'observation'
  | 'git'
  | 'test'
  | 'mini-skill'
  | 'graph-relation';

export interface WorksetFixtureEvidence {
  id: string;
  kind: WorksetFixtureEvidenceKind;
  locator: string;
  summary: string;
}

export interface WorksetEvaluationFixtureCase extends WorksetEvaluationFixture {
  repositoryPath: string;
  requiredFiles: string[];
  evidence: WorksetFixtureEvidence[];
}

export const WORKSET_EVALUATION_FIXTURES: WorksetEvaluationFixtureCase[] = [
  {
    id: 'typescript-auth',
    title: 'TypeScript auth change',
    task: 'Continue the token validation regression in the auth middleware.',
    repositoryPath: 'typescript-auth',
    requiredFiles: ['src/auth.ts', 'tests/auth.test.ts'],
    evidence: [
      {
        id: 'obs:auth-boundary',
        kind: 'observation',
        locator: 'src/auth.ts#validateToken',
        summary: 'Token validation is owned by the auth boundary.',
      },
      {
        id: 'git:auth-boundary-fix',
        kind: 'git',
        locator: 'commit:auth-boundary-fix',
        summary: 'The boundary was introduced to reject short tokens.',
      },
      {
        id: 'test:auth-validation',
        kind: 'test',
        locator: 'tests/auth.test.ts',
        summary: 'The test locks the rejection behavior.',
      },
      {
        id: 'skill:auth-regression',
        kind: 'mini-skill',
        locator: 'auth-regression',
        summary: 'Reproduce the focused regression before changing auth code.',
      },
      {
        id: 'relation:auth-to-session',
        kind: 'graph-relation',
        locator: 'auth -> session',
        summary: 'The auth boundary supports session creation.',
      },
    ],
    expectation: {
      requiredStartHere: ['src/auth.ts'],
      requiredEvidenceIds: ['obs:auth-boundary', 'test:auth-validation'],
      maxTokens: 320,
      maxTokensByVariant: { 'candidate-workset': 180 },
    },
  },
  {
    id: 'python-worker',
    title: 'Python worker retry',
    task: 'Fix the worker retry behavior without dropping failed jobs.',
    repositoryPath: 'python-worker',
    requiredFiles: ['app/worker.py'],
    evidence: [
      {
        id: 'obs:worker-retry',
        kind: 'observation',
        locator: 'app/worker.py#dispatch_job',
        summary: 'Retry count must remain bounded before a job is marked failed.',
      },
    ],
    expectation: {
      requiredStartHere: ['app/worker.py'],
      requiredEvidenceIds: ['obs:worker-retry'],
      maxTokens: 320,
      maxTokensByVariant: { 'candidate-workset': 180 },
    },
  },
  {
    id: 'go-service',
    title: 'Go service health check',
    task: 'Continue the health endpoint timeout investigation.',
    repositoryPath: 'go-service',
    requiredFiles: ['internal/health/health.go'],
    evidence: [
      {
        id: 'obs:health-timeout',
        kind: 'observation',
        locator: 'internal/health/health.go#Check',
        summary: 'The health check should reject non-positive deadlines.',
      },
    ],
    expectation: {
      requiredStartHere: ['internal/health/health.go'],
      requiredEvidenceIds: ['obs:health-timeout'],
      maxTokens: 320,
      maxTokensByVariant: { 'candidate-workset': 180 },
    },
  },
  {
    id: 'docs-only',
    title: 'Docs-only architecture decision',
    task: 'Review the deployment rollback decision before changing documentation.',
    repositoryPath: 'docs-only',
    requiredFiles: ['docs/architecture.md'],
    evidence: [
      {
        id: 'obs:rollback-policy',
        kind: 'observation',
        locator: 'docs/architecture.md',
        summary: 'Rollback always returns to the last verified release.',
      },
    ],
    expectation: {
      requiredStartHere: ['docs/architecture.md'],
      requiredEvidenceIds: ['obs:rollback-policy'],
      maxTokens: 320,
      maxTokensByVariant: { 'candidate-workset': 180 },
    },
  },
  {
    id: 'dirty-worktree',
    title: 'Dirty configuration change',
    task: 'Continue the uncommitted configuration migration.',
    repositoryPath: 'dirty-worktree',
    requiredFiles: ['src/config.ts'],
    evidence: [
      {
        id: 'obs:config-migration',
        kind: 'observation',
        locator: 'src/config.ts#rolloutMode',
        summary: 'The staged rollout setting is being migrated.',
      },
      {
        id: 'git:dirty-config',
        kind: 'git',
        locator: 'worktree:dirty',
        summary: 'The configuration edit is not committed yet.',
      },
    ],
    expectation: {
      requiredStartHere: ['src/config.ts'],
      requiredEvidenceIds: ['obs:config-migration'],
      requiredCautions: ['dirty-worktree'],
      maxTokens: 320,
      maxTokensByVariant: { 'candidate-workset': 180 },
    },
  },
  {
    id: 'deleted-symbol',
    title: 'Deleted router symbol',
    task: 'Replace the removed legacy router entry point.',
    repositoryPath: 'deleted-symbol',
    requiredFiles: ['src/router.ts'],
    evidence: [
      {
        id: 'obs:legacy-router',
        kind: 'observation',
        locator: 'src/legacy-router.ts#legacyRoute',
        summary: 'The legacy entry point was removed and needs replacement guidance.',
      },
      {
        id: 'relation:legacy-to-router',
        kind: 'graph-relation',
        locator: 'legacy-router -> router',
        summary: 'The current router is the replacement boundary.',
      },
    ],
    expectation: {
      requiredStartHere: ['src/router.ts'],
      requiredEvidenceIds: ['obs:legacy-router'],
      requiredCautions: ['deleted-symbol'],
      maxTokens: 320,
      maxTokensByVariant: { 'candidate-workset': 180 },
    },
  },
  {
    id: 'incomplete-scan',
    title: 'Oversized generated source',
    task: 'Investigate a bug while the generated schema is outside the scan budget.',
    repositoryPath: 'incomplete-scan',
    requiredFiles: ['src/schema.ts'],
    evidence: [
      {
        id: 'obs:schema-contract',
        kind: 'observation',
        locator: 'src/schema.ts',
        summary: 'The generated schema is relevant but exceeds the configured scan limit.',
      },
      {
        id: 'test:schema-budget',
        kind: 'test',
        locator: 'scan:maxFileBytes',
        summary: 'The safety limit must remain visible to the next agent.',
      },
    ],
    expectation: {
      requiredStartHere: ['src/schema.ts'],
      requiredEvidenceIds: ['obs:schema-contract'],
      requiredCautions: ['incomplete-scan'],
      maxTokens: 320,
      maxTokensByVariant: { 'candidate-workset': 180 },
    },
  },
];
