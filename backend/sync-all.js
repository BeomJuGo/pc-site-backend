const BASE = process.env.API_BASE_URL || 'http://localhost:10000/api';
const apiBase = BASE.endsWith('/api') ? BASE : `${BASE}/api`;
const ADMIN_KEY = process.env.ADMIN_API_KEY || '';

const endpoints = [
  { name: 'CPU',         url: `${apiBase}/admin/sync-cpus`,         body: { pages: 10, benchPages: 6, ai: true, force: false } },
  { name: 'GPU',         url: `${apiBase}/admin/sync-gpus`,         body: { pages: 10, ai: true, force: false } },
  { name: 'Motherboard', url: `${apiBase}/admin/sync-motherboards`, body: { pages: 8, ai: true, force: false } },
  { name: 'Memory',      url: `${apiBase}/admin/sync-memory`,       body: { pages: 8, limit: 60, ai: true, force: false } },
  { name: 'PSU',         url: `${apiBase}/admin/sync-psu`,          body: { pages: 8, ai: true, force: false } },
  { name: 'Case',        url: `${apiBase}/admin/sync-case`,         body: { pages: 8, ai: true, force: false } },
  { name: 'Cooler',      url: `${apiBase}/admin/sync-cooler`,       body: { pages: 8, ai: true, force: false } },
  { name: 'Storage',     url: `${apiBase}/admin/sync-storage`,      body: { pages: 8, ai: true, force: false } },
];

const headers = {
  'Content-Type': 'application/json',
  ...(ADMIN_KEY ? { Authorization: `Bearer ${ADMIN_KEY}` } : {}),
};

async function post(name, url, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const data = await res.json().catch(() => ({}));
    console.log(`\u2705 ${name}: ${res.status} ${res.statusText}`);
    console.log(`   ${data.message || JSON.stringify(data)}`);
    return { name, ok: res.ok };
  } catch (e) {
    console.log(`\u274C ${name}: ${e.message}`);
    return { name, ok: false, error: e.message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  let filteredEndpoints = endpoints;

  if (args.length > 0) {
    const filterNames = args.map(arg => arg.toLowerCase());
    filteredEndpoints = endpoints.filter(ep => filterNames.includes(ep.name.toLowerCase()));

    if (filteredEndpoints.length === 0) {
      console.log(`\u274C \ucc3e\uc744 \uc218 \uc5c6\ub294 \ub77c\uc6b0\ud130: ${args.join(', ')}`);
      console.log(`\u2705 \uc0ac\uc6a9 \uac00\ub2a5\ud55c \ub77c\uc6b0\ud130: ${endpoints.map(e => e.name).join(', ')}`);
      process.exit(1);
    }
    console.log(`\uD83C\uDFAF \uc120\ud0dd\ub41c \ub77c\uc6b0\ud130: ${filteredEndpoints.map(e => e.name).join(', ')}`);
  } else {
    console.log('\uD83D\uDE80 8\uac1c \ub77c\uc6b0\ud130 \ub3d9\uae30\ud654 \uc2dc\uc791');
  }

  console.log(`\uD83C\uDF10 API Base URL: ${apiBase}`);
  if (!ADMIN_KEY) console.warn('\u26A0\uFE0F  ADMIN_API_KEY \ubbf8\uc124\uc815 \u2014 admin \uc5d4\ub4dc\ud3ec\uc778\ud2b8 \uc778\uc99d \uc2e4\ud328 \uac00\ub2a5\uc131 \uc788\uc74c');

  const results = [];
  for (const ep of filteredEndpoints) {
    const result = await post(ep.name, ep.url, ep.body);
    results.push(result);
    await new Promise(r => setTimeout(r, 1000));
  }

  const ok = results.filter(r => r.ok).map(r => r.name);
  const fail = results.filter(r => !r.ok).map(r => `${r.name}: ${r.error}`);
  console.log('\n\uD83D\uDCCA \uacb0\uacfc \uc694\uc57d');
  console.log(`   \u2705 \uc131\uacf5: ${ok.length}\uac1c${ok.length ? ` (${ok.join(', ')})` : ''}`);
  if (fail.length) console.log(`   \u274C \uc2e4\ud328: ${fail.length}\uac1c\n     - ${fail.join('\n     - ')}`);
  console.log('\u2705 \uc694\uccad \uc804\uc1a1 \uc644\ub8cc (\uc11c\ubc84 \ub85c\uadf8\uc5d0\uc11c \uc9c4\ud589 \uc0c1\ud669 \ud655\uc778)');
}

main().catch(err => { console.error(err); process.exit(1); });
