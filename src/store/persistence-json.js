/**
 * JSON Persistence Helpers — Migration / Export / Debug Only
 *
 * These functions read/write JSON/JSONL files for one-time migration
 * from legacy storage formats into SQLite, or for export/import and debug.
 *
 * NOT used as runtime canonical store — SQLite is the sole canonical backend.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from './file-lock.js';
/**
 * Get the file path for the knowledge graph JSONL file.
 * (MCP-compatible format, same as official Memory Server)
 */
export function getGraphFilePath(projectDir) {
    return path.join(projectDir, 'graph.jsonl');
}
/**
 * Save the knowledge graph in JSONL format (MCP-compatible).
 * Each line is a JSON object with type: "entity" or "relation".
 *
 * Format adopted from MCP Official Memory Server.
 */
export async function saveGraphJsonl(projectDir, entities, relations) {
    const lines = [
        ...entities.map((e) => JSON.stringify({ type: 'entity', name: e.name, entityType: e.entityType, observations: e.observations })),
        ...relations.map((r) => JSON.stringify({ type: 'relation', from: r.from, to: r.to, relationType: r.relationType })),
    ];
    await atomicWriteFile(getGraphFilePath(projectDir), lines.join('\n'));
}
/**
 * Load the knowledge graph from JSONL format.
 */
export async function loadGraphJsonl(projectDir) {
    const filePath = getGraphFilePath(projectDir);
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        const lines = data.split('\n').filter((line) => line.trim() !== '');
        return lines.reduce((graph, line) => {
            const item = JSON.parse(line);
            if (item.type === 'entity') {
                graph.entities.push({
                    name: item.name,
                    entityType: item.entityType,
                    observations: item.observations,
                });
            }
            if (item.type === 'relation') {
                graph.relations.push({
                    from: item.from,
                    to: item.to,
                    relationType: item.relationType,
                });
            }
            return graph;
        }, {
            entities: [],
            relations: []
        });
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return { entities: [], relations: [] };
        }
        throw error;
    }
}
/**
 * Save observation data as JSON (for Orama restore / export).
 */
export async function saveObservationsJson(projectDir, observations) {
    const filePath = path.join(projectDir, 'observations.json');
    await atomicWriteFile(filePath, JSON.stringify(observations, null, 2));
}
/**
 * Load observation data from JSON.
 */
export async function loadObservationsJson(projectDir) {
    const filePath = path.join(projectDir, 'observations.json');
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}
/**
 * Save the next observation ID counter (legacy JSON format).
 */
export async function saveIdCounter(projectDir, nextId) {
    const filePath = path.join(projectDir, 'counter.json');
    await atomicWriteFile(filePath, JSON.stringify({ nextId }));
}
/**
 * Load the next observation ID counter (legacy JSON format).
 * For runtime use, prefer the SQLite meta table via SqliteBackend.
 */
export async function loadIdCounter(projectDir) {
    const filePath = path.join(projectDir, 'counter.json');
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data).nextId ?? 1;
    }
    catch {
        return 1;
    }
}
/**
 * Save mini-skills data as JSON (migration source only).
 */
export async function saveMiniSkillsJson(projectDir, skills) {
    const filePath = path.join(projectDir, 'mini-skills.json');
    await atomicWriteFile(filePath, JSON.stringify(skills, null, 2));
}
/**
 * Load mini-skills data from JSON (migration source only).
 */
export async function loadMiniSkillsJson(projectDir) {
    const filePath = path.join(projectDir, 'mini-skills.json');
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}
/**
 * Load the mini-skills ID counter (legacy JSON format).
 */
export async function loadMiniSkillsCounter(projectDir) {
    const filePath = path.join(projectDir, 'mini-skills-counter.json');
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data).nextId ?? 1;
    }
    catch {
        return 1;
    }
}
/**
 * Save the mini-skills ID counter (legacy JSON format).
 */
export async function saveMiniSkillsCounter(projectDir, nextId) {
    const filePath = path.join(projectDir, 'mini-skills-counter.json');
    await atomicWriteFile(filePath, JSON.stringify({ nextId }));
}
/**
 * Save sessions data as JSON (migration source only).
 */
export async function saveSessionsJson(projectDir, sessions) {
    const filePath = path.join(projectDir, 'sessions.json');
    await atomicWriteFile(filePath, JSON.stringify(sessions, null, 2));
}
/**
 * Load sessions data from JSON (migration source only).
 */
export async function loadSessionsJson(projectDir) {
    const filePath = path.join(projectDir, 'sessions.json');
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}
//# sourceMappingURL=persistence-json.js.map