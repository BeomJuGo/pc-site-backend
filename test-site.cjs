const { chromium } = require('C:/Users/lom00/AppData/Roaming/npm/node_modules/playwright');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function testSite() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const errors = [];
  const results = [];

  const log = (msg) => { console.log(msg); results.push(msg); };
  const fail = (msg) => { console.error('❌ ' + msg); errors.push(msg); };
  const ok = (msg) => console.log('✅ ' + msg);

  // Capture console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Capture network failures
  const netFails = [];
  page.on('response', res => {
    if (!res.ok() && !res.url().includes('favicon')) {
      netFails.push(`${res.status()} ${res.url()}`);
    }
  });

  try {
    // ─── 1. HOME ─────────────────────────────────────────────────
    log('\n=== 1. 홈페이지 ===');
    await page.goto('https://goodpricepc.vercel.app', { waitUntil: 'networkidle', timeout: 30000 });
    const title = await page.title();
    ok(`홈 로드 완료 (title: ${title})`);

    const hero = await page.$('text=GoodPricePC');
    if (hero) ok('히어로 텍스트 존재');
    else fail('히어로 텍스트 없음');

    // Check category cards
    const catCards = await page.$$('text=탐색하기');
    log(`카테고리 카드 수: ${catCards.length} (기대: 8)`);
    if (catCards.length < 8) fail(`카테고리 카드 부족 (${catCards.length}/8)`);

    // ─── 2. CPU 카테고리 ────────────────────────────────────────
    log('\n=== 2. CPU 카테고리 ===');
    await page.goto('https://goodpricepc.vercel.app/category/cpu', { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(2000);

    const cpuItems = await page.$$('[class*="cursor-pointer"]');
    log(`CPU 목록 아이템 수: ${cpuItems.length}`);
    if (cpuItems.length === 0) fail('CPU 목록 비어있음');

    // Check prices
    const priceEls = await page.$$eval('*', els =>
      els.filter(e => e.textContent.match(/\d{1,3}(,\d{3})*원/)).map(e => e.textContent.trim()).slice(0, 5)
    );
    log(`CPU 가격 샘플: ${priceEls.slice(0,3).join(' | ')}`);

    // ─── 3. CPU 상세 페이지 ─────────────────────────────────────
    log('\n=== 3. CPU 상세 페이지 ===');
    const firstItem = await page.$('[class*="cursor-pointer"]');
    if (firstItem) {
      await firstItem.click();
      await page.waitForLoadState('networkidle', { timeout: 15000 });
      await sleep(1500);

      const currentUrl = page.url();
      log(`상세 URL: ${currentUrl}`);

      // Check price history chart
      const chart = await page.$('.recharts-wrapper, [class*="recharts"]');
      if (chart) ok('가격 추이 차트 존재');
      else fail('가격 추이 차트 없음');

      // Check multi-mall prices
      const multiMall = await page.$('text=쇼핑몰별 최저가');
      if (multiMall) ok('쇼핑몰별 최저가 섹션 존재');
      else fail('쇼핑몰별 최저가 섹션 없음');

      // Check danawa link
      const danawa = await page.$('text=다나와');
      if (danawa) ok('다나와 링크 존재');
      else log('다나와 링크 없음');

      // Check alert form
      const alertForm = await page.$('text=가격 알림');
      if (alertForm) ok('가격 알림 섹션 존재');
      else fail('가격 알림 섹션 없음');
    }

    // ─── 4. GPU 카테고리 ────────────────────────────────────────
    log('\n=== 4. GPU 카테고리 ===');
    await page.goto('https://goodpricepc.vercel.app/category/gpu', { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(2000);
    const gpuItems = await page.$$('[class*="cursor-pointer"]');
    log(`GPU 목록 아이템 수: ${gpuItems.length}`);
    if (gpuItems.length === 0) fail('GPU 목록 비어있음');

    // ─── 5. 나머지 카테고리 ─────────────────────────────────────
    for (const cat of ['memory', 'motherboard', 'storage', 'case', 'cooler', 'psu']) {
      log(`\n=== 카테고리: ${cat} ===`);
      await page.goto(`https://goodpricepc.vercel.app/category/${cat}`, { waitUntil: 'networkidle', timeout: 30000 });
      await sleep(1500);
      const items = await page.$$('[class*="cursor-pointer"]');
      log(`  아이템 수: ${items.length}`);
      if (items.length === 0) fail(`${cat} 목록 비어있음`);
      else ok(`${cat}: ${items.length}개 로드됨`);
    }

    // ─── 6. 검색 ────────────────────────────────────────────────
    log('\n=== 6. 검색 기능 ===');
    await page.goto('https://goodpricepc.vercel.app/search?q=RTX+4070', { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(3000);
    const searchResults = await page.$$('[class*="cursor-pointer"]');
    log(`검색 결과 (RTX 4070): ${searchResults.length}개`);
    if (searchResults.length === 0) fail('검색 결과 없음 - /api/parts/search 엔드포인트 확인 필요');
    else ok(`검색 결과 ${searchResults.length}개`);

    // Check search API directly
    const searchRes = await page.evaluate(async () => {
      const r = await fetch('/api/parts/search?q=RTX+4070&limit=5');
      return { status: r.status, data: await r.json() };
    });
    log(`검색 API 응답: status=${searchRes.status}, count=${Array.isArray(searchRes.data) ? searchRes.data.length : JSON.stringify(searchRes.data)}`);

    // ─── 7. AI 추천 ─────────────────────────────────────────────
    log('\n=== 7. AI 추천 ===');
    await page.goto('https://goodpricepc.vercel.app/ai-recommend', { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(1500);

    // Fill budget
    const budgetInput = await page.$('input[type="number"], input[placeholder*="예산"]');
    if (budgetInput) {
      await budgetInput.fill('1000000');
      ok('예산 입력 성공');
    } else {
      fail('예산 입력 필드 없음');
    }

    // Select purpose
    const gameBtn = await page.$('button:has-text("게임용"), [value="게임용"]');
    if (gameBtn) {
      await gameBtn.click();
      ok('게임용 선택');
    }

    // Click submit
    const submitBtn = await page.$('button:has-text("추천"), button:has-text("견적"), button[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
      log('추천 요청 중...');
      await sleep(8000); // AI takes time

      // Check results
      const totalPrice = await page.$('text=총합');
      if (totalPrice) {
        const priceText = await totalPrice.evaluate(el => el.textContent);
        log(`AI 추천 총합: ${priceText}`);
        if (priceText.includes('0원') || priceText.includes('0 원')) {
          fail('AI 추천 총합이 0원 - 데이터 파싱 문제');
        } else {
          ok('AI 추천 총합 정상');
        }
      } else {
        fail('AI 추천 결과 없음 또는 총합 미표시');
      }

      // Check individual parts
      const partNames = ['CPU', 'GPU', '메모리', '메인보드', '저장장치'];
      for (const p of partNames) {
        const el = await page.$(`text=${p}`);
        if (el) ok(`AI 추천에 ${p} 표시됨`);
      }
    } else {
      fail('추천 버튼 없음');
    }

    // ─── 8. 즐겨찾기 ────────────────────────────────────────────
    log('\n=== 8. 즐겨찾기 ===');
    await page.goto('https://goodpricepc.vercel.app/favorites', { waitUntil: 'networkidle', timeout: 15000 });
    await sleep(1000);
    const favEmpty = await page.$('text=즐겨찾기');
    if (favEmpty) ok('즐겨찾기 페이지 로드됨');
    else fail('즐겨찾기 페이지 오류');

    // ─── 9. 비교 ────────────────────────────────────────────────
    log('\n=== 9. 비교 페이지 ===');
    await page.goto('https://goodpricepc.vercel.app/compare', { waitUntil: 'networkidle', timeout: 15000 });
    await sleep(1000);
    const compareEmpty = await page.$('text=비교할 부품이 없습니다');
    if (compareEmpty) ok('비교 페이지 로드됨 (빈 상태)');
    else fail('비교 페이지 오류');

    // ─── 10. About/Guide/Privacy/Terms ──────────────────────────
    log('\n=== 10. 정보 페이지 ===');
    for (const [path, keyword] of [
      ['/about', '소개'],
      ['/guide', '가이드'],
      ['/privacy', '개인정보'],
      ['/terms', '이용약관'],
    ]) {
      await page.goto(`https://goodpricepc.vercel.app${path}`, { waitUntil: 'networkidle', timeout: 15000 });
      await sleep(500);
      const el = await page.$(`text=${keyword}`);
      if (el) ok(`${path} 페이지 로드됨`);
      else fail(`${path} 페이지 오류`);
    }

    // ─── 11. API 직접 테스트 ─────────────────────────────────────
    log('\n=== 11. API 직접 테스트 ===');
    await page.goto('https://goodpricepc.vercel.app', { waitUntil: 'domcontentloaded', timeout: 15000 });

    const apiTests = [
      { name: 'parts/cpu', url: '/api/parts?category=cpu' },
      { name: 'parts/search', url: '/api/parts/search?q=RTX&limit=3' },
      { name: 'recommend', url: null }, // POST - tested separately
    ];

    for (const t of apiTests) {
      if (!t.url) continue;
      const r = await page.evaluate(async (url) => {
        try {
          const res = await fetch(url);
          const data = await res.json();
          return { status: res.status, count: Array.isArray(data) ? data.length : Object.keys(data).length, sample: JSON.stringify(data).slice(0, 100) };
        } catch(e) { return { error: e.message }; }
      }, t.url);
      if (r.error) fail(`API ${t.name}: ${r.error}`);
      else log(`  API ${t.name}: status=${r.status}, count=${r.count}, sample=${r.sample}`);
    }

    // Test recommend API
    const recRes = await page.evaluate(async () => {
      try {
        const res = await fetch('/api/recommend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ budget: 1000000, purpose: '게임용' })
        });
        const data = await res.json();
        return { status: res.status, keys: Object.keys(data), sample: JSON.stringify(data).slice(0, 200) };
      } catch(e) { return { error: e.message }; }
    });
    log(`  API recommend: status=${recRes.status}, keys=${JSON.stringify(recRes.keys)}`);
    if (recRes.error) fail(`recommend API: ${recRes.error}`);
    else log(`  recommend sample: ${recRes.sample}`);

    // ─── 12. 콘솔 에러 확인 ─────────────────────────────────────
    log('\n=== 12. 콘솔 에러 ===');
    if (consoleErrors.length === 0) ok('콘솔 에러 없음');
    else {
      consoleErrors.forEach(e => fail(`콘솔 에러: ${e}`));
    }

    // ─── 네트워크 실패 확인 ──────────────────────────────────────
    log('\n=== 네트워크 실패 ===');
    if (netFails.length === 0) ok('네트워크 실패 없음');
    else netFails.forEach(f => log(`  ⚠️ ${f}`));

  } catch (e) {
    fail(`테스트 중 예외 발생: ${e.message}`);
    console.error(e.stack);
  } finally {
    await browser.close();
  }

  log('\n========== 최종 결과 ==========');
  if (errors.length === 0) {
    log('✅ 모든 테스트 통과');
  } else {
    log(`❌ 발견된 문제 ${errors.length}개:`);
    errors.forEach((e, i) => log(`  ${i+1}. ${e}`));
  }
  return errors;
}

testSite().then(errors => process.exit(errors.length > 0 ? 1 : 0)).catch(e => { console.error(e); process.exit(1); });
