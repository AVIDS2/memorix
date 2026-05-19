/**
 * GraphView — Knowledge graph text browser.
 *
 * Modes: browse (clusters + nodes), detail (single node with edge summary).
 * Keyboard: f filter, up/down navigate, enter detail, k -> Knowledge, esc back.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { COLORS, SEP, SYMBOLS, TYPE_ICONS, EDGE_SYMBOLS } from '../theme.js';
import type { MemoryNavTarget } from './MemoryView.js';
import type { ProjectKnowledgeGraph, SemanticNode, SemanticEdge, KnowledgeGraphCluster } from '../../../wiki/types.js';
import { getKnowledgeGraph } from '../data.js';

function separator(width = 50): string {
  return SEP.thin.repeat(width);
}

function truncate(text: string, max = 80): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

export type { MemoryNavTarget };

interface GraphViewProps {
  projectId?: string;
  inputFocused: boolean;
  onNavigateKnowledge: (target: MemoryNavTarget) => void;
}

type FilterMode = 'all' | 'cluster' | 'type';

/** Flat item in the browse list — either a cluster header or a node row. */
interface FlatItem {
  kind: 'cluster' | 'node';
  id: string;
  label: string;
  clusterId: string;
  clusterLabel: string;
  nodeIndex?: number; // index within cluster
  node?: SemanticNode;
}

export function GraphView({ projectId, inputFocused, onNavigateKnowledge }: GraphViewProps): React.ReactElement {
  const [graph, setGraph] = useState<ProjectKnowledgeGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [filterValue, setFilterValue] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [detailNode, setDetailNode] = useState<SemanticNode | null>(null);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    const g = await getKnowledgeGraph(projectId);
    setGraph(g);
    setSelectedIdx(0);
    setDetailNode(null);
    setFilterMode('all');
    setFilterValue('');
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  // Compute flat item list from graph + current filter
  const flatItems = buildFlatItems(graph, filterMode, filterValue);

  // Filter options derived from graph data
  const clusters: KnowledgeGraphCluster[] = graph?.clusters ?? [];
  const nodeTypes: string[] = [...new Set((graph?.nodes ?? []).map((n) => n.nodeType))].sort();

  // ── Helpers for edge lookups ──
  const nodeEdgeIndex = buildEdgeIndex(graph?.edges ?? []);

  // ── Keyboard ──
  useInput((ch, key) => {
    if (inputFocused) return;

    // Esc: dismiss detail back to browse
    if (key.escape && detailNode) {
      setDetailNode(null);
      return;
    }

    if (key.upArrow) { setSelectedIdx(Math.max(0, selectedIdx - 1)); return; }
    if (key.downArrow) { setSelectedIdx(selectedIdx + 1); return; }

    if (key.return) {
      // Enter: expand detail on selected node
      const item = flatItems[Math.min(selectedIdx, flatItems.length - 1)];
      if (item && item.kind === 'node' && item.node) {
        setDetailNode(item.node);
      }
      return;
    }

    if (ch === 'f' && !key.ctrl && !key.meta) {
      cycleFilter();
      setSelectedIdx(0);
      return;
    }

    // In filter mode, left/right switch filter value
    if (filterMode !== 'all' && key.leftArrow) {
      cycleFilterValue(-1);
      setSelectedIdx(0);
      return;
    }
    if (filterMode !== 'all' && key.rightArrow) {
      cycleFilterValue(1);
      setSelectedIdx(0);
      return;
    }

    if (ch === 'k' && !key.ctrl && !key.meta) {
      if (detailNode) {
        onNavigateKnowledge({
          type: 'knowledge',
          refIds: detailNode.refs.map((r) => r.id),
          entityName: detailNode.entityName || undefined,
        });
      } else {
        const item = flatItems[Math.min(selectedIdx, flatItems.length - 1)];
        if (item && item.kind === 'node' && item.node) {
          const node = item.node;
          onNavigateKnowledge({
            type: 'knowledge',
            refIds: node.refs.map((r) => r.id),
            entityName: node.entityName || undefined,
          });
        }
      }
      return;
    }
  });

  function cycleFilter(): void {
    if (filterMode === 'all') {
      setFilterMode('cluster');
      setFilterValue(clusters[0]?.sectionId ?? '');
    } else if (filterMode === 'cluster') {
      setFilterMode('type');
      setFilterValue(nodeTypes[0] ?? '');
    } else {
      setFilterMode('all');
      setFilterValue('');
    }
  }

  function cycleFilterValue(delta: number): void {
    const options = filterMode === 'cluster'
      ? clusters.map((c) => c.sectionId)
      : nodeTypes;
    const idx = options.indexOf(filterValue);
    const next = idx < 0 ? 0 : ((idx + delta) % options.length + options.length) % options.length;
    setFilterValue(options[next] ?? '');
  }

  // ── Detail mode ──
  if (detailNode) {
    const incoming = nodeEdgeIndex.incoming.get(detailNode.id) ?? [];
    const outgoing = nodeEdgeIndex.outgoing.get(detailNode.id) ?? [];
    const clusterLabel = clusters.find((c) => c.sectionId === detailNode.sectionId)?.label ?? detailNode.sectionId;

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box>
          <Text color={COLORS.brand} bold>Graph Node Detail</Text>
        </Box>
        <Text color={COLORS.border}>{separator()}</Text>
        <Box marginY={1} flexDirection="column">
          <Text color={COLORS.muted}>{TYPE_ICONS[detailNode.nodeType] || SYMBOLS.bullet} {detailNode.nodeType}</Text>
          <Text color={COLORS.text} bold>{detailNode.label}</Text>
          {detailNode.entityName && <Text color={COLORS.textDim}>entity: {detailNode.entityName}</Text>}
          <Text color={COLORS.muted}>cluster: {clusterLabel}</Text>
          <Text color={COLORS.muted}>evidence: {detailNode.evidenceCount}</Text>
        </Box>
        {detailNode.summary && (
          <Box marginY={1} flexDirection="column">
            <Text color={COLORS.textDim}>{truncate(detailNode.summary, 400)}</Text>
          </Box>
        )}
        {detailNode.refs.length > 0 && (
          <Box marginY={1} flexDirection="column">
            <Text color={COLORS.muted}>refs: {detailNode.refs.map((r) => r.id).join(', ')}</Text>
          </Box>
        )}
        {/* Edge summary */}
        <Box marginY={1} flexDirection="column">
          <Text color={COLORS.brandDim} bold>Edges</Text>
          <Text color={COLORS.muted}>Outgoing ({outgoing.length}): </Text>
          {outgoing.slice(0, 6).map((e) => {
            const targetNode = graph?.nodes.find((n) => n.id === e.target);
            return (
              <Text key={e.id} color={COLORS.textDim}>
                {'  '}{EDGE_SYMBOLS[e.edgeType] ?? '--'} {truncate(targetNode?.label ?? e.target, 40)}
              </Text>
            );
          })}
          {outgoing.length > 6 && <Text color={COLORS.muted}>  ... +{outgoing.length - 6} more</Text>}
          <Text color={COLORS.muted}>Incoming ({incoming.length}): </Text>
          {incoming.slice(0, 6).map((e) => {
            const sourceNode = graph?.nodes.find((n) => n.id === e.source);
            return (
              <Text key={e.id} color={COLORS.textDim}>
                {'  '}{EDGE_SYMBOLS[e.edgeType] ?? '--'} {truncate(sourceNode?.label ?? e.source, 40)}
              </Text>
            );
          })}
          {incoming.length > 6 && <Text color={COLORS.muted}>  ... +{incoming.length - 6} more</Text>}
        </Box>
        <Box marginTop={1}>
          <Text color={COLORS.muted}>esc back  |  k {'>'} Knowledge</Text>
        </Box>
      </Box>
    );
  }

  // ── Browse mode ──
  const filterLabel = filterMode === 'all'
    ? 'All'
    : filterMode === 'cluster'
      ? `Cluster: ${clusters.find((c) => c.sectionId === filterValue)?.label ?? filterValue}`
      : `Type: ${filterValue}`;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="column">
        <Box>
          <Text color={COLORS.brand} bold>Knowledge Graph</Text>
          {!loading && graph && (
            <Text color={COLORS.muted}> | {graph.stats.totalNodes} nodes, {graph.stats.totalEdges} edges, {graph.stats.clusterCount} clusters</Text>
          )}
        </Box>
        {/* Filter bar */}
        {!loading && graph && (
          <Box marginTop={0}>
            <Text color={COLORS.accentDim}>[{filterLabel}]</Text>
            <Text color={COLORS.muted}>  f filter  {filterMode !== 'all' ? 'left/right switch' : ''}</Text>
          </Box>
        )}
      </Box>
      <Text color={COLORS.border}>{separator()}</Text>

      {loading ? (
        <Text color={COLORS.muted}>Loading...</Text>
      ) : !graph ? (
        <Text color={COLORS.muted}>No graph data available. Store observations to build the knowledge graph.</Text>
      ) : flatItems.length === 0 ? (
        <Text color={COLORS.muted}>
          {filterMode !== 'all' ? 'No nodes match this filter.' : 'No nodes in graph.'}
        </Text>
      ) : (
        flatItems.map((item, idx) => {
          const isSelected = idx === selectedIdx;

          if (item.kind === 'cluster') {
            return (
              <Box key={item.id} marginTop={idx > 0 ? 1 : 0}>
                <Text color={COLORS.brandDim} bold>{item.label}</Text>
                <Text color={COLORS.muted}> ({getClusterNodeCount(graph, item.clusterId)})</Text>
              </Box>
            );
          }

          // Node row
          const icon = TYPE_ICONS[item.node!.nodeType] || SYMBOLS.bullet;
          const edgeCount = (nodeEdgeIndex.outgoing.get(item.node!.id)?.length ?? 0)
            + (nodeEdgeIndex.incoming.get(item.node!.id)?.length ?? 0);
          return (
            <Box key={item.id}>
              <Text color={isSelected ? COLORS.brand : COLORS.muted}>
                {isSelected ? '>' : ' '}
              </Text>
              <Text color={COLORS.muted}> {icon} </Text>
              <Text color={isSelected ? COLORS.brand : COLORS.text}>
                {truncate(item.node!.label, 50)}
              </Text>
              {item.node!.entityName && (
                <Text color={COLORS.muted}> [{item.node!.entityName}]</Text>
              )}
              <Text color={COLORS.muted}> [{edgeCount}]</Text>
            </Box>
          );
        })
      )}

      <Box marginTop={1} flexDirection="column">
        <Text color={COLORS.textDim}>
          f filter  |  up/down navigate  |  enter detail  |  k {'>'} Knowledge
        </Text>
      </Box>
    </Box>
  );
}

// ── Helpers ──

interface EdgeIndex {
  incoming: Map<string, SemanticEdge[]>;
  outgoing: Map<string, SemanticEdge[]>;
}

function buildEdgeIndex(edges: SemanticEdge[]): EdgeIndex {
  const incoming = new Map<string, SemanticEdge[]>();
  const outgoing = new Map<string, SemanticEdge[]>();
  for (const e of edges) {
    const inc = incoming.get(e.target) ?? [];
    inc.push(e);
    incoming.set(e.target, inc);

    const out = outgoing.get(e.source) ?? [];
    out.push(e);
    outgoing.set(e.source, out);
  }
  return { incoming, outgoing };
}

function buildFlatItems(graph: ProjectKnowledgeGraph | null, filterMode: FilterMode, filterValue: string): FlatItem[] {
  if (!graph) return [];

  const items: FlatItem[] = [];
  const clusters = graph.clusters;

  for (const cluster of clusters) {
    const clusterNodes = graph.nodes.filter((n) => n.sectionId === cluster.sectionId);

    // Apply type filter
    const visibleNodes = filterMode === 'type' && filterValue
      ? clusterNodes.filter((n) => n.nodeType === filterValue)
      : clusterNodes;

    if (visibleNodes.length === 0) continue;

    // When filtering by cluster, skip non-matching clusters
    if (filterMode === 'cluster' && filterValue && cluster.sectionId !== filterValue) continue;

    // Add cluster header
    if (filterMode === 'all') {
      items.push({
        kind: 'cluster',
        id: `cluster-hdr:${cluster.id}`,
        label: cluster.label,
        clusterId: cluster.sectionId,
        clusterLabel: cluster.label,
      });
    }

    // Add nodes
    for (let i = 0; i < visibleNodes.length; i++) {
      items.push({
        kind: 'node',
        id: visibleNodes[i].id,
        label: visibleNodes[i].label,
        clusterId: cluster.sectionId,
        clusterLabel: cluster.label,
        nodeIndex: i,
        node: visibleNodes[i],
      });
    }
  }

  return items;
}

function getClusterNodeCount(graph: ProjectKnowledgeGraph, sectionId: string): number {
  return graph.nodes.filter((n) => n.sectionId === sectionId).length;
}
