/**
 * Manual E2E test: Formation Pipeline LLM quality via real MCP HTTP server
 * 
 * Prerequisites:
 *   1. Start server: node dist/cli/index.js serve-http --port 37850
 *   2. Run this:     node tests/integration/formation-llm-manual.mjs
 */

const PORT = 37850;
const BASE = `http://127.0.0.1:${PORT}/mcp`;

async function main() {
  console.log('=== Formation Pipeline LLM Quality Test ===\n');

  // Step 1: Initialize session
  const initRes = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'formation-test', version: '1.0' } }
    })
  });
  const sid = initRes.headers.get('mcp-session-id');
  console.log('Session ID:', sid);
  if (!sid) { console.error('ERROR: No session ID'); process.exit(1); }

  // Step 2: Send initialized notification
  await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'mcp-session-id': sid },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
  });

  // Wait for server deferred init
  console.log('Waiting for server init...');
  await new Promise(r => setTimeout(r, 4000));

  // Step 3: Store a rich memory to test Formation LLM
  console.log('\nStoring test memory...');
  const t0 = Date.now();

  const storeRes = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'mcp-session-id': sid },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: {
        name: 'memorix_store',
        arguments: {
          entityName: 'database-migration',
          type: 'decision',
          title: 'Chose PostgreSQL over MongoDB for ACID compliance',
          narrative: 'After 2 weeks of evaluation, we decided to migrate from MongoDB to PostgreSQL. The main driver was ACID compliance requirements for financial transactions. MongoDB was faster for reads (avg 2ms vs 8ms) but could not guarantee transaction isolation under concurrent writes. We tested with 10000 concurrent transactions and found 0.3% data inconsistency with MongoDB vs 0% with PostgreSQL. The migration involved rewriting 47 query functions, adding 12 new indexes, and updating the ORM from Mongoose to Prisma. Total migration took 3 sprints. Performance mitigation: added Redis caching layer (port 6379) which brought read latency down to 3ms. Trade-off: lost MongoDB flexible schema but gained referential integrity. Decision approved in Architecture Review Board meeting on 2025-01-15.',
        }
      }
    })
  });

  const elapsed = Date.now() - t0;
  const text = await storeRes.text();

  // Parse SSE response
  const dataLine = text.split('\n').find(l => l.startsWith('data: '));
  if (dataLine) {
    const json = JSON.parse(dataLine.replace('data: ', ''));
    const content = json.result?.content?.[0]?.text || 'No content';
    console.log('\n=== Result ===');
    console.log(content);
    console.log(`\nElapsed: ${elapsed}ms (${(elapsed / 1000).toFixed(1)}s)`);
  } else {
    console.log('Raw response:', text.substring(0, 500));
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
