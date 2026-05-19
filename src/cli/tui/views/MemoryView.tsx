/**
 * MemoryView — Memory search, browse, and detail.
 *
 * Modes: browse (recent), search (results), detail (single observation).
 * Keyboard: / to focus search, ↑↓ to navigate, k → Knowledge jump,
 * enter for detail, esc to go back to browse.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { COLORS, SEP, SYMBOLS, TYPE_ICONS } from '../theme.js';
import type { MemoryItem, SearchResult } from '../data.js';
import { getRecentMemories, searchMemories } from '../data.js';

function separator(width = 50): string {
  return SEP.thin.repeat(width);
}

function truncate(text: string, max = 60): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

export interface MemoryNavTarget {
  type: 'knowledge';
  refIds: string[];
  entityName?: string;
}

interface MemoryViewProps {
  projectId?: string;
  focusRefId?: string;
  selectedIdx: number;
  onNavigateKnowledge: (target: MemoryNavTarget) => void;
  inputFocused: boolean;
}

export function MemoryView({ projectId, focusRefId, selectedIdx, onNavigateKnowledge, inputFocused }: MemoryViewProps): React.ReactElement {
  const [mode, setMode] = useState<'browse' | 'search' | 'detail'>('browse');
  const [items, setItems] = useState<(MemoryItem | SearchResult)[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [detailItem, setDetailItem] = useState<{ id: number; title: string; type: string; entityName?: string } | null>(null);
  const [detailContent, setDetailContent] = useState<string>('');

  const loadRecent = useCallback(async () => {
    setLoading(true);
    const recent = await getRecentMemories(12, projectId);
    setItems(recent);
    setMode('browse');
    setDetailItem(null);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  // If focusRefId is passed, load that observation detail
  useEffect(() => {
    if (!focusRefId) return;
    const idMatch = focusRefId.match(/^obs:(\d+)$/);
    if (!idMatch) return;

    (async () => {
      try {
        setLoading(true);
        const { getObservation, initObservations, getAllObservations } = await import('../../../memory/observations.js');
        const { getProjectDataDir } = await import('../../../store/persistence.js');
        const { initObservationStore } = await import('../../../store/obs-store.js');
        const { detectProject } = await import('../../../project/detector.js');

        const proj = detectProject(process.cwd());
        if (!proj) return;

        const dataDir = await getProjectDataDir(projectId || proj.id);
        await initObservationStore(dataDir);
        await initObservations(dataDir);

        const obsId = parseInt(idMatch[1], 10);
        const allObs = getAllObservations();
        const obs = allObs.find((o: any) => o.id === obsId);
        if (obs) {
          setDetailItem({
            id: obs.id,
            title: obs.title || '(untitled)',
            type: obs.type || 'discovery',
            entityName: obs.entityName || '',
          });
          setDetailContent(obs.narrative || JSON.stringify(obs, null, 2));
          setMode('detail');
        }
      } catch {
        // Focus ref not found — stay in browse
      } finally {
        setLoading(false);
      }
    })();
  }, [focusRefId, projectId]);

  // ── Keyboard: k → Knowledge jump (canonical ref-based path) ──
  useInput((ch, key) => {
    if (ch !== 'k' || key.ctrl || key.meta || inputFocused) return;
    if (!onNavigateKnowledge) return;

    if (mode === 'detail' && detailItem) {
      const refs = extractRefs(detailContent, detailItem);
      onNavigateKnowledge({
        type: 'knowledge',
        refIds: refs,
        entityName: detailItem.entityName || undefined,
      });
    } else if ((mode === 'browse' || mode === 'search') && items.length > 0) {
      const idx = Math.min(selectedIdx, items.length - 1);
      const item = items[idx];
      if (item) {
        onNavigateKnowledge({
          type: 'knowledge',
          refIds: [`obs:${item.id}`],
          entityName: item.entityName || undefined,
        });
      }
    }
  });

  if (mode === 'detail' && detailItem) {
    const refs = extractRefs(detailContent, detailItem);
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box>
          <Text color={COLORS.brand} bold>Memory Detail</Text>
        </Box>
        <Text color={COLORS.border}>{separator()}</Text>
        <Box marginY={1} flexDirection="column">
          <Text color={COLORS.muted}>#{detailItem.id}  {TYPE_ICONS[detailItem.type] || SYMBOLS.bullet}  {detailItem.type}</Text>
          <Text color={COLORS.text} bold>{detailItem.title}</Text>
          {detailItem.entityName && <Text color={COLORS.textDim}>entity: {detailItem.entityName}</Text>}
        </Box>
        <Box marginY={1} flexDirection="column">
          <Text color={COLORS.textDim}>{detailContent.slice(0, 500)}</Text>
        </Box>
        {refs.length > 0 && (
          <Box marginY={1} flexDirection="column">
            <Text color={COLORS.muted}>refs: {refs.join(', ')}</Text>
            <Text color={COLORS.textDim}>k {'>'} Knowledge (ref-based jump)</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={COLORS.muted}>esc back  |  {refs.length > 0 ? 'k jump to Knowledge  |  ' : ''}/ search</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text color={COLORS.brand} bold>
          {mode === 'search' ? `Search: "${searchQuery}"` : 'Recent Memory'}
        </Text>
        {!loading && mode === 'browse' && (
          <Text color={COLORS.muted}> | {items.length} items</Text>
        )}
        {!loading && mode === 'search' && (
          <Text color={COLORS.muted}> | {items.length} results</Text>
        )}
      </Box>
      <Text color={COLORS.border}>{separator()}</Text>

      {loading ? (
        <Text color={COLORS.muted}>Loading…</Text>
      ) : items.length === 0 ? (
        <Text color={COLORS.muted}>
          {mode === 'search' ? 'No results found.' : 'No recent activity. Use /remember to store a memory.'}
        </Text>
      ) : (
        items.map((item, idx) => {
          const isSelected = idx === selectedIdx;
          const prefix = isSelected ? SYMBOLS.arrow : ' ';
          const icon = 'icon' in item ? (item as SearchResult).icon : TYPE_ICONS[item.type] || SYMBOLS.bullet;
          return (
            <Box key={item.id} flexDirection="column">
              <Box>
                <Text color={isSelected ? COLORS.brand : COLORS.muted}>{prefix} </Text>
                <Text color={COLORS.muted}>{icon} </Text>
                <Text color={COLORS.textDim}>#{item.id} </Text>
                <Text color={isSelected ? COLORS.brand : COLORS.text}>{truncate(item.title)}</Text>
                {'score' in item && (
                  <Text color={COLORS.accent}> {(item as SearchResult).score.toFixed(0)}%</Text>
                )}
              </Box>
              {item.entityName && (
                <Box>
                  <Text color={COLORS.muted}>     </Text>
                  <Text color={COLORS.textDim}>[{item.entityName}]</Text>
                </Box>
              )}
            </Box>
          );
        })
      )}

      <Box marginTop={1} flexDirection="column">
        <Text color={COLORS.textDim}>
          / search  |  up/down navigate  |  enter detail  |  k {'>'} Knowledge (refs-based)
        </Text>
      </Box>
    </Box>
  );
}

function extractRefs(content: string, item: { id: number; entityName?: string }): string[] {
  const refs: string[] = [];
  // Match obs:N references in the content
  const obsMatch = content.match(/obs:(\d+)/g);
  if (obsMatch) refs.push(...obsMatch);
  // Also include the item's own id
  refs.push(`obs:${item.id}`);
  return [...new Set(refs)].slice(0, 8);
}
