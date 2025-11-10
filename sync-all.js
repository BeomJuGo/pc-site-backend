import axios from 'axios';

// 환경 변수로 BASE URL 설정 (GitHub Actions에서 사용)
// 로컬 개발: http://localhost:10000
// 프로덕션: https://pc-site-backend.onrender.com
const BASE = process.env.API_BASE_URL || 'http://localhost:10000/api';

// API_BASE_URL이 /api로 끝나지 않으면 자동으로 추가
const apiBase = BASE.endsWith('/api') ? BASE : `${BASE}/api`;

const endpoints = [
  { name: 'CPU', url: `${apiBase}/admin/sync-cpus`, body: { pages: 10, benchPages: 6, ai: true, force: false } },
  { name: 'GPU', url: `${apiBase}/admin/sync-gpus`, body: { pages: 10, ai: true, force: false } },
  { name: 'Motherboard', url: `${apiBase}/sync-motherboards`, body: { pages: 8, ai: true, force: false } },
  { name: 'Memory', url: `${apiBase}/sync-memory`, body: { pages: 8, limit: 60, ai: true, force: false } },
  { name: 'PSU', url: `${apiBase}/sync-psu`, body: { pages: 8, ai: true, force: false } },
  { name: 'Case', url: `${apiBase}/sync-case`, body: { pages: 8, ai: true, force: false } },
  { name: 'Cooler', url: `${apiBase}/sync-cooler`, body: { pages: 8, ai: true, force: false } },
  { name: 'Storage', url: `${apiBase}/sync-storage`, body: { pages: 8, ai: true, force: false } },
];

async function post(name, url, body) {
  try {
    const res = await axios.post(url, body, { timeout: 60000, headers: { 'Content-Type': 'application/json' } });
    console.log(`✅${name}: ${res.status} ${res.statusText}`);
    console.log(`   ${typeof res.data === 'string' ? res.data : (res.data.message || JSON.stringify(res.data))}`);
    return { name, ok: true };
  } catch (e) {
    const msg = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    console.log(`❌${name}: ${msg}`);
    return { name, ok: false, error: msg };
  }
}

async function main() {
  // 명령줄 인자로 필터링 (예: node sync-all.js cpu 또는 node sync-all.js cpu gpu)
  const args = process.argv.slice(2);
  let filteredEndpoints = endpoints;

  if (args.length > 0) {
    const filterNames = args.map(arg => arg.toLowerCase());
    filteredEndpoints = endpoints.filter(ep =>
      filterNames.includes(ep.name.toLowerCase())
    );

    if (filteredEndpoints.length === 0) {
      console.log(`❌ 찾을 수 없는 라우터: ${args.join(', ')}`);
      console.log(`✅ 사용 가능한 라우터: ${endpoints.map(e => e.name).join(', ')}`);
      process.exit(1);
    }

    console.log(`🎯 선택된 라우터: ${filteredEndpoints.map(e => e.name).join(', ')}`);
  } else {
    console.log('🚀 8개 라우터 동기화 시작');
  }

  console.log(`🌐 API Base URL: ${apiBase}`);

  const results = [];
  for (const ep of filteredEndpoints) {
    const result = await post(ep.name, ep.url, ep.body);
    results.push(result);
    await new Promise(r => setTimeout(r, 1000));
  }
  const ok = results.filter(r => r.ok).map(r => r.name);
  const fail = results.filter(r => !r.ok).map(r => `${r.name}: ${r.error}`);
  console.log('\n📊 결과 요약');
  console.log(`   ✅ 성공: ${ok.length} 개${ok.length ? ` (${ok.join(', ')})` : ''}`);
  if (fail.length) console.log(`   ❌ 실패: ${fail.length} 개\n     - ${fail.join('\n     - ')}`);
  console.log('✅ 요청 전송 완료 (서버 로그에서 진행 상황 확인)');
}

main().catch(err => { console.error(err); process.exit(1); });
