/**
 * KnowledgeView — Wiki browser for the shared knowledge layer.
 *
 * Displays ProjectKnowledgeOverview sections and items.
 * Each item shows its provenance refs; pressing 'm' on an item
 * jumps to Memory view focused on that ref.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { COLORS, SEP, SYMBOLS } from '../theme.js';
import type { ProjectKnowledgeOverview } from '../../../wiki/types.js';

function separator(width = 50): string {
  return SEP.thin.repeat(width);
}

function truncate(text: string, max = 80): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

export interface KnowledgeNavTarget {
  type: 'memory';
  refId: string;
}

interface KnowledgeViewProps {
  knowledge: ProjectKnowledgeOverview | null;
  loading: boolean;
  selectedItemIdx: number;
  itemCount: number;
}

export function KnowledgeView({ knowledge, loading, selectedItemIdx, itemCount }: KnowledgeViewProps): React.ReactElement {
  if (loading) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={COLORS.brand} bold>Knowledge Base</Text>
        <Text color={COLORS.muted}>  LLM Wiki</Text>
        <Text color={COLORS.border}>{separator()}</Text>
        <Text color={COLORS.muted}>Loading…</Text>
      </Box>
    );
  }

  if (!knowledge) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={COLORS.brand} bold>Knowledge Base</Text>
        <Text color={COLORS.muted}>  LLM Wiki</Text>
        <Text color={COLORS.border}>{separator()}</Text>
        <Text color={COLORS.warning}>No knowledge available for this project.</Text>
        <Text color={COLORS.textDim}>Store memories with /remember or use Workbench to build context.</Text>
      </Box>
    );
  }

  // Flatten all items into a linear list for keyboard navigation
  const flatItems: Array<{ sectionIdx: number; itemIdx: number; item: typeof knowledge.sections[0]['items'][0]; sectionTitle: string }> = [];
  for (const [sectionIdx, section] of knowledge.sections.entries()) {
    for (const [itemIdx, item] of section.items.entries()) {
      flatItems.push({ sectionIdx, itemIdx, item, sectionTitle: section.title });
    }
  }

  let globalIdx = 0;
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text color={COLORS.brand} bold>Knowledge Base</Text>
        <Text color={COLORS.muted}>  LLM Wiki</Text>
      </Box>
      <Box>
        <Text color={COLORS.textDim}>  {knowledge.projectId}</Text>
        <Text color={COLORS.muted}> | {knowledge.stats.observationsUsed} obs, {knowledge.stats.miniSkillsUsed} skills</Text>
      </Box>
      <Text color={COLORS.border}>{separator()}</Text>

      {knowledge.sections.map((section) => (
        <Box key={section.id} flexDirection="column" marginBottom={1}>
          <Text color={COLORS.brandDim} bold>{section.title}</Text>
          {section.empty ? (
            <Text color={COLORS.textDim}>  (empty)</Text>
          ) : (
            section.items.map((item, itemIdx) => {
              const isSelected = selectedItemIdx >= 0 && globalIdx === selectedItemIdx;
              const prefix = isSelected ? SYMBOLS.arrow : ' ';
              globalIdx++;
              return (
                <Box key={itemIdx} flexDirection="column">
                  <Box>
                    <Text color={isSelected ? COLORS.brand : COLORS.muted}>{prefix} </Text>
                    <Text color={isSelected ? COLORS.brand : COLORS.text}>{truncate(item.title)}</Text>
                    {item.entityName && <Text color={COLORS.textDim}> [{item.entityName}]</Text>}
                  </Box>
                  <Text color={COLORS.textDim}>  {truncate(item.summary, 80)}</Text>
                  <Text color={COLORS.muted}>  refs: {item.refs.map((r) => r.id).join(', ')}</Text>
                </Box>
              );
            })
          )}
        </Box>
      ))}

      <Box marginTop={1} flexDirection="column">
        <Text color={COLORS.textDim}>{`${flatItems.length} items`}  |  up/down navigate  |  m {'>'} Memory  |  enter details</Text>
      </Box>
    </Box>
  );
}
