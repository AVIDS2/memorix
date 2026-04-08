/**
 * ConfigureView — Ink-native configuration panel.
 *
 * Replaces the @clack/prompts fallback. Users stay in the TUI at all times.
 * Supports: LLM, Embedding, Behavior, Show Config.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { COLORS } from './theme.js';
import * as fs from 'node:fs';

// ── Types ──

interface ConfigData {
  llm?: { provider?: string; apiKey?: string; model?: string; baseUrl?: string };
  embedding?: string;
  embeddingApi?: { apiKey?: string; baseUrl?: string; model?: string };
  behavior?: { sessionInject?: string; formationMode?: string };
  [key: string]: unknown;
}

type ConfigSection = 'menu' | 'llm' | 'llm-provider' | 'llm-apikey' | 'llm-model' | 'llm-baseurl'
  | 'embedding' | 'emb-apikey' | 'emb-baseurl' | 'emb-model'
  | 'behavior' | 'behavior-session' | 'behavior-formation'
  | 'show';

interface ConfigureViewProps {
  onBack: () => void;
}

// ── Helpers ──

function getConfigPath(): string {
  return `${process.env.HOME || process.env.USERPROFILE}/.memorix/config.json`;
}

function loadConfig(): ConfigData {
  try {
    const p = getConfigPath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { /* ignore */ }
  return {};
}

function saveConfig(config: ConfigData): void {
  const dir = `${process.env.HOME || process.env.USERPROFILE}/.memorix`;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}

function separator(w = 50): string { return '-'.repeat(w); }
function mask(key?: string): string {
  if (!key) return '(not set)';
  if (key.length <= 8) return '****';
  return '****...' + key.slice(-4);
}

// ── Select list component ──

function SelectList({ items, selectedIndex, onSelect }: {
  items: { key: string; label: string; hint?: string; color?: string }[];
  selectedIndex: number;
  onSelect: (key: string) => void;
}): React.ReactElement {
  useInput((ch, key) => {
    if (key.return && items[selectedIndex]) {
      onSelect(items[selectedIndex].key);
    }
  });

  return (
    <Box flexDirection="column">
      {items.map((item, i) => (
        <Box key={item.key}>
          <Text color={i === selectedIndex ? COLORS.accent : COLORS.muted}>
            {i === selectedIndex ? '> ' : '  '}
          </Text>
          <Text color={item.color || (i === selectedIndex ? COLORS.accent : COLORS.text)} bold={i === selectedIndex}>
            {item.label}
          </Text>
          {item.hint && <Text color={COLORS.textDim}> {item.hint}</Text>}
        </Box>
      ))}
    </Box>
  );
}

// ── Text input component (inline, no external dep) ──

function InlineInput({ label, value, onChange, onSubmit, isPassword }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  isPassword?: boolean;
}): React.ReactElement {
  useInput((ch, key) => {
    if (key.return) { onSubmit(); return; }
    if (key.backspace || key.delete) { onChange(value.slice(0, -1)); return; }
    if (ch && !key.ctrl && !key.meta && !key.escape) { onChange(value + ch); }
  });

  const display = isPassword ? '*'.repeat(value.length) : value;
  return (
    <Box>
      <Text color={COLORS.accentDim}>{label}: </Text>
      <Text color={COLORS.text}>{display}</Text>
      <Text backgroundColor={COLORS.accent} color={COLORS.bg}> </Text>
    </Box>
  );
}

// ── Main ConfigureView ──

export function ConfigureView({ onBack }: ConfigureViewProps): React.ReactElement {
  const [section, setSection] = useState<ConfigSection>('menu');
  const [menuIndex, setMenuIndex] = useState(0);
  const [subIndex, setSubIndex] = useState(0);
  const [config, setConfig] = useState<ConfigData>(loadConfig);
  const [feedback, setFeedback] = useState('');
  const [inputValue, setInputValue] = useState('');

  // Reload config when entering menu
  useEffect(() => {
    if (section === 'menu') setConfig(loadConfig());
  }, [section]);

  // Shared navigation for menu/sub-menu sections
  const isMenu = section === 'menu';
  const isSubSelect = ['llm', 'llm-provider', 'embedding', 'behavior', 'behavior-session', 'behavior-formation', 'emb-model'].includes(section);
  const isInput = ['llm-apikey', 'llm-model', 'llm-baseurl', 'emb-apikey', 'emb-baseurl'].includes(section);

  useInput((ch, key) => {
    // Esc always goes back one level
    if (key.escape) {
      if (section === 'menu') { onBack(); return; }
      if (isInput) {
        // Go back to parent section
        if (section.startsWith('llm-')) { setSection('llm'); return; }
        if (section.startsWith('emb-')) { setSection('embedding'); return; }
      }
      setSection('menu');
      setFeedback('');
      return;
    }

    // Arrow keys for select lists
    if (isMenu && key.upArrow) { setMenuIndex(i => Math.max(0, i - 1)); return; }
    if (isMenu && key.downArrow) { setMenuIndex(i => Math.min(MENU_ITEMS.length - 1, i + 1)); return; }
    if (isSubSelect && key.upArrow) { setSubIndex(i => Math.max(0, i - 1)); return; }
    if (isSubSelect && key.downArrow) { setSubIndex(i => i + 1); return; }
  }, { isActive: !isInput });

  // ── Menu items ──
  const MENU_ITEMS = [
    { key: 'llm', label: 'LLM Enhanced Mode', hint: `(${config.llm?.provider ?? 'off'})` },
    { key: 'embedding', label: 'Embedding Provider', hint: `(${config.embedding ?? 'off'})` },
    { key: 'behavior', label: 'Behavior Settings', hint: '' },
    { key: 'show', label: 'Show Current Config', hint: '' },
    { key: 'back', label: 'Back to Home', hint: '', color: COLORS.muted },
  ];

  // ── LLM provider options ──
  const LLM_PROVIDERS = [
    { key: 'openai', label: 'OpenAI', hint: 'gpt-4o-mini' },
    { key: 'anthropic', label: 'Anthropic', hint: 'claude-3-haiku' },
    { key: 'openrouter', label: 'OpenRouter', hint: 'multi-provider' },
    { key: 'custom', label: 'Custom endpoint', hint: 'OpenAI-compatible' },
    { key: 'disable', label: 'Disable LLM', hint: 'free heuristic mode', color: COLORS.warning },
    { key: 'back', label: 'Back', hint: '', color: COLORS.muted },
  ];

  // ── Embedding options ──
  const EMB_OPTIONS = [
    { key: 'off', label: 'Off (default)', hint: 'BM25 fulltext only' },
    { key: 'api', label: 'API (recommended)', hint: 'OpenAI-compatible' },
    { key: 'fastembed', label: 'FastEmbed', hint: 'local ONNX' },
    { key: 'transformers', label: 'Transformers', hint: 'local JS/WASM' },
    { key: 'back', label: 'Back', hint: '', color: COLORS.muted },
  ];

  const SESSION_OPTIONS = [
    { key: 'full', label: 'Full' },
    { key: 'minimal', label: 'Minimal (default)' },
    { key: 'silent', label: 'Silent' },
    { key: 'back', label: 'Back', color: COLORS.muted },
  ];

  const FORMATION_OPTIONS = [
    { key: 'active', label: 'Active (default)', hint: 'Formation decides storage' },
    { key: 'shadow', label: 'Shadow', hint: 'Formation observes, old compact decides' },
    { key: 'fallback', label: 'Fallback', hint: 'Old compact only' },
    { key: 'back', label: 'Back', color: COLORS.muted },
  ];

  const BEHAVIOR_ITEMS = [
    { key: 'session', label: 'Session Injection', hint: `(${config.behavior?.sessionInject ?? 'minimal'})` },
    { key: 'formation', label: 'Formation Mode', hint: `(${config.behavior?.formationMode ?? 'active'})` },
    { key: 'back', label: 'Back', hint: '', color: COLORS.muted },
  ];

  const EMB_MODEL_OPTIONS = [
    { key: 'text-embedding-3-small', label: 'text-embedding-3-small' },
    { key: 'text-embedding-3-large', label: 'text-embedding-3-large' },
    { key: 'back', label: 'Back', color: COLORS.muted },
  ];

  // ── Handlers ──

  const handleMenuSelect = (key: string) => {
    setFeedback('');
    if (key === 'back') { onBack(); return; }
    if (key === 'show') { setSection('show'); return; }
    setSubIndex(0);
    setSection(key as ConfigSection);
  };

  const handleLLMSelect = (key: string) => {
    if (key === 'back') { setSection('menu'); return; }
    if (key === 'disable') {
      const c = { ...config }; delete c.llm; saveConfig(c); setConfig(c);
      setFeedback('LLM disabled.'); setSection('menu'); return;
    }
    // Store chosen provider, move to API key input
    setConfig(prev => ({ ...prev, _pendingProvider: key }));
    setInputValue('');
    setSection('llm-apikey');
  };

  const handleLLMApiKeyDone = () => {
    if (!inputValue.trim()) { setSection('llm'); return; }
    setConfig(prev => ({ ...prev, _pendingApiKey: inputValue.trim() }));
    // If custom provider, ask for baseUrl next
    if ((config as any)._pendingProvider === 'custom') {
      setInputValue(''); setSection('llm-baseurl'); return;
    }
    setInputValue(getDefaultModel((config as any)._pendingProvider));
    setSection('llm-model');
  };

  const handleLLMBaseUrlDone = () => {
    setConfig(prev => ({ ...prev, _pendingBaseUrl: inputValue.trim() || undefined }));
    setInputValue(getDefaultModel((config as any)._pendingProvider));
    setSection('llm-model');
  };

  const handleLLMModelDone = () => {
    const provider = (config as any)._pendingProvider;
    const c: ConfigData = { ...config };
    c.llm = {
      provider: provider === 'custom' ? 'openai' : provider,
      apiKey: (config as any)._pendingApiKey,
      model: inputValue.trim() || getDefaultModel(provider),
      baseUrl: (config as any)._pendingBaseUrl,
    };
    delete (c as any)._pendingProvider;
    delete (c as any)._pendingApiKey;
    delete (c as any)._pendingBaseUrl;
    saveConfig(c); setConfig(c);
    setFeedback(`LLM configured: ${c.llm!.model}`);
    setSection('menu');
  };

  const handleEmbeddingSelect = (key: string) => {
    if (key === 'back') { setSection('menu'); return; }
    if (key === 'api') {
      setInputValue(''); setSection('emb-apikey'); return;
    }
    const c = { ...config, embedding: key }; delete c.embeddingApi;
    saveConfig(c); setConfig(c);
    setFeedback(`Embedding set to: ${key}`); setSection('menu');
  };

  const handleEmbApiKeyDone = () => {
    setConfig(prev => ({ ...prev, _pendingEmbKey: inputValue.trim() || undefined }));
    setInputValue(''); setSection('emb-baseurl');
  };

  const handleEmbBaseUrlDone = () => {
    setConfig(prev => ({ ...prev, _pendingEmbUrl: inputValue.trim() || undefined }));
    setSubIndex(0); setSection('emb-model');
  };

  const handleEmbModelSelect = (key: string) => {
    if (key === 'back') { setSection('embedding'); return; }
    const c: ConfigData = { ...config, embedding: 'api' };
    c.embeddingApi = {
      apiKey: (config as any)._pendingEmbKey,
      baseUrl: (config as any)._pendingEmbUrl,
      model: key,
    };
    delete (c as any)._pendingEmbKey;
    delete (c as any)._pendingEmbUrl;
    saveConfig(c); setConfig(c);
    setFeedback(`API embedding configured: ${key}`); setSection('menu');
  };

  const handleBehaviorSelect = (key: string) => {
    if (key === 'back') { setSection('menu'); return; }
    setSubIndex(0);
    if (key === 'session') setSection('behavior-session');
    else if (key === 'formation') setSection('behavior-formation');
  };

  const handleSessionSelect = (key: string) => {
    if (key === 'back') { setSection('behavior'); return; }
    const c = { ...config, behavior: { ...config.behavior, sessionInject: key } };
    saveConfig(c); setConfig(c);
    setFeedback(`Session injection: ${key}`); setSection('menu');
  };

  const handleFormationSelect = (key: string) => {
    if (key === 'back') { setSection('behavior'); return; }
    const c = { ...config, behavior: { ...config.behavior, formationMode: key } };
    saveConfig(c); setConfig(c);
    setFeedback(`Formation mode: ${key}`); setSection('menu');
  };

  // ── Render ──

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={COLORS.accentDim} bold>Configure Memorix</Text>
      <Text color={COLORS.border}>{separator()}</Text>

      {feedback && (
        <Box marginBottom={1}>
          <Text color={COLORS.success}>{feedback}</Text>
        </Box>
      )}

      {section === 'menu' && (
        <Box flexDirection="column">
          <SelectList items={MENU_ITEMS} selectedIndex={menuIndex} onSelect={handleMenuSelect} />
          <Box marginTop={1}><Text color={COLORS.muted}>Up/Down + Enter to select | Esc to go back</Text></Box>
        </Box>
      )}

      {section === 'llm' && (
        <Box flexDirection="column">
          <Text color={COLORS.text} bold>LLM Provider</Text>
          <SelectList items={LLM_PROVIDERS} selectedIndex={Math.min(subIndex, LLM_PROVIDERS.length - 1)} onSelect={handleLLMSelect} />
        </Box>
      )}

      {section === 'llm-apikey' && (
        <Box flexDirection="column">
          <Text color={COLORS.text} bold>LLM API Key</Text>
          <InlineInput label="API key" value={inputValue} onChange={setInputValue} onSubmit={handleLLMApiKeyDone} isPassword />
          <Text color={COLORS.muted}>Enter to confirm | Esc to cancel</Text>
        </Box>
      )}

      {section === 'llm-baseurl' && (
        <Box flexDirection="column">
          <Text color={COLORS.text} bold>Custom Base URL</Text>
          <InlineInput label="Base URL" value={inputValue} onChange={setInputValue} onSubmit={handleLLMBaseUrlDone} />
          <Text color={COLORS.muted}>Leave empty for default | Enter to confirm</Text>
        </Box>
      )}

      {section === 'llm-model' && (
        <Box flexDirection="column">
          <Text color={COLORS.text} bold>Model Name</Text>
          <InlineInput label="Model" value={inputValue} onChange={setInputValue} onSubmit={handleLLMModelDone} />
          <Text color={COLORS.muted}>Enter to confirm</Text>
        </Box>
      )}

      {section === 'embedding' && (
        <Box flexDirection="column">
          <Text color={COLORS.text} bold>Embedding Provider</Text>
          <SelectList items={EMB_OPTIONS} selectedIndex={Math.min(subIndex, EMB_OPTIONS.length - 1)} onSelect={handleEmbeddingSelect} />
        </Box>
      )}

      {section === 'emb-apikey' && (
        <Box flexDirection="column">
          <Text color={COLORS.text} bold>Embedding API Key</Text>
          <InlineInput label="API key (empty = reuse LLM key)" value={inputValue} onChange={setInputValue} onSubmit={handleEmbApiKeyDone} isPassword />
          <Text color={COLORS.muted}>Enter to confirm</Text>
        </Box>
      )}

      {section === 'emb-baseurl' && (
        <Box flexDirection="column">
          <Text color={COLORS.text} bold>Embedding Base URL</Text>
          <InlineInput label="Base URL (empty = default)" value={inputValue} onChange={setInputValue} onSubmit={handleEmbBaseUrlDone} />
          <Text color={COLORS.muted}>Enter to confirm</Text>
        </Box>
      )}

      {section === 'emb-model' && (
        <Box flexDirection="column">
          <Text color={COLORS.text} bold>Embedding Model</Text>
          <SelectList items={EMB_MODEL_OPTIONS} selectedIndex={Math.min(subIndex, EMB_MODEL_OPTIONS.length - 1)} onSelect={handleEmbModelSelect} />
        </Box>
      )}

      {section === 'behavior' && (
        <Box flexDirection="column">
          <Text color={COLORS.text} bold>Behavior Settings</Text>
          <SelectList items={BEHAVIOR_ITEMS} selectedIndex={Math.min(subIndex, BEHAVIOR_ITEMS.length - 1)} onSelect={handleBehaviorSelect} />
        </Box>
      )}

      {section === 'behavior-session' && (
        <Box flexDirection="column">
          <Text color={COLORS.text} bold>Session Injection</Text>
          <Text color={COLORS.textDim}>Current: {config.behavior?.sessionInject ?? 'minimal'}</Text>
          <SelectList items={SESSION_OPTIONS} selectedIndex={Math.min(subIndex, SESSION_OPTIONS.length - 1)} onSelect={handleSessionSelect} />
        </Box>
      )}

      {section === 'behavior-formation' && (
        <Box flexDirection="column">
          <Text color={COLORS.text} bold>Formation Mode</Text>
          <Text color={COLORS.textDim}>Current: {config.behavior?.formationMode ?? 'active'}</Text>
          <SelectList items={FORMATION_OPTIONS} selectedIndex={Math.min(subIndex, FORMATION_OPTIONS.length - 1)} onSelect={handleFormationSelect} />
        </Box>
      )}

      {section === 'show' && (
        <Box flexDirection="column">
          <Text color={COLORS.text} bold>Current Configuration</Text>
          <Box marginTop={1} flexDirection="column">
            <Box><Text color={COLORS.muted}>{'Config file'.padEnd(16)}</Text><Text color={COLORS.textDim}>{getConfigPath()}</Text></Box>
            <Box><Text color={COLORS.muted}>{'LLM Provider'.padEnd(16)}</Text><Text color={COLORS.text}>{config.llm?.provider ?? 'off'}</Text></Box>
            <Box><Text color={COLORS.muted}>{'LLM Model'.padEnd(16)}</Text><Text color={COLORS.text}>{config.llm?.model ?? '(default)'}</Text></Box>
            <Box><Text color={COLORS.muted}>{'LLM API Key'.padEnd(16)}</Text><Text color={COLORS.text}>{mask(config.llm?.apiKey)}</Text></Box>
            {config.llm?.baseUrl && <Box><Text color={COLORS.muted}>{'LLM Base URL'.padEnd(16)}</Text><Text color={COLORS.text}>{config.llm.baseUrl}</Text></Box>}
            <Box><Text color={COLORS.muted}>{'Embedding'.padEnd(16)}</Text><Text color={COLORS.text}>{config.embedding ?? 'off'}</Text></Box>
            {config.embeddingApi?.model && <Box><Text color={COLORS.muted}>{'Emb Model'.padEnd(16)}</Text><Text color={COLORS.text}>{config.embeddingApi.model}</Text></Box>}
            {config.embeddingApi?.baseUrl && <Box><Text color={COLORS.muted}>{'Emb Base URL'.padEnd(16)}</Text><Text color={COLORS.text}>{config.embeddingApi.baseUrl}</Text></Box>}
            <Box><Text color={COLORS.muted}>{'Session Inject'.padEnd(16)}</Text><Text color={COLORS.text}>{config.behavior?.sessionInject ?? 'minimal'}</Text></Box>
            <Box><Text color={COLORS.muted}>{'Formation'.padEnd(16)}</Text><Text color={COLORS.text}>{config.behavior?.formationMode ?? 'active'}</Text></Box>
          </Box>
          <Box marginTop={1}><Text color={COLORS.muted}>Esc to go back</Text></Box>
        </Box>
      )}
    </Box>
  );
}

function getDefaultModel(provider: string): string {
  if (provider === 'anthropic') return 'claude-3-haiku-20240307';
  if (provider === 'openrouter') return 'openai/gpt-4o-mini';
  return 'gpt-4o-mini';
}
