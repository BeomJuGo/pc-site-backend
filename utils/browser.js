// utils/browser.js
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { existsSync } from "fs";

const DEFAULT_PROTOCOL_TIMEOUT = Number(
  process.env.PUPPETEER_PROTOCOL_TIMEOUT || 240000
);

// 공통 광고/추적 차단 호스트 목록
export const BLOCK_HOSTS = [
  'google-analytics.com', 'analytics.google.com', 'googletagmanager.com', 'google.com/ccm',
  'ad.danawa.com', 'dsas.danawa.com', 'service-api.flarelane.com', 'doubleclick.net',
  'adnxs.com', 'googlesyndication.com', 'scorecardresearch.com', 'facebook.net',
];

export async function getBrowserConfig() {
  const isRender = process.env.RENDER === 'true' || process.env.RENDER_SERVICE_NAME || process.env.RENDER_EXTERNAL_URL;

  if (isRender) {
    chromium.setGraphicsMode = false;
    return {
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
      protocolTimeout: DEFAULT_PROTOCOL_TIMEOUT,
    };
  }

  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  if (existsSync(chromePath)) {
    return {
      executablePath: chromePath,
      args: [
        '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
        '--disable-setuid-sandbox', '--no-first-run', '--no-zygote',
        '--single-process', '--disable-extensions', '--disable-web-security',
        '--disable-features=VizDisplayCompositor'
      ],
      defaultViewport: { width: 1280, height: 720 },
      headless: true,
      ignoreHTTPSErrors: true,
      protocolTimeout: DEFAULT_PROTOCOL_TIMEOUT,
    };
  }

  chromium.setGraphicsMode = false;
  return {
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
    protocolTimeout: DEFAULT_PROTOCOL_TIMEOUT,
  };
}

export async function launchBrowser() {
  const config = await getBrowserConfig();
  return await puppeteer.launch(config);
}

/**
 * 다나와 크롤링용 공통 페이지 설정
 * 광고 차단, 한국어 설정, 웹드라이버 감지 우회, User-Agent 설정
 */
export async function setupPage(page, timeout = 60000) {
  await page.setDefaultTimeout(timeout);
  await page.setDefaultNavigationTimeout(timeout);
  await page.emulateTimezone('Asia/Seoul');
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7' });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    const type = req.resourceType();
    if (BLOCK_HOSTS.some(h => url.includes(h))) return req.abort();
    if (type === 'media' || type === 'font') return req.abort();
    return req.continue();
  });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
}

/**
 * 다나와 AJAX 페이지네이션 이동
 * sleep(5000) 제거 → 페이지당 ~4.5초 절약
 * @param {import('puppeteer-core').Page} page
 * @param {number} pageNum - 이동할 페이지 번호 (1이면 no-op)
 * @param {string} itemSelector - 로딩 완료 확인용 CSS 선택자
 */
export async function navigateToDanawaPage(page, pageNum, itemSelector = '.main_prodlist .prod_item') {
  if (pageNum === 1) return;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const pageSelector = `a.num[page="${pageNum}"]`;
  const pageExists = await page.evaluate(
    (sel) => !!document.querySelector(sel),
    pageSelector
  );

  if (pageExists) {
    await page.click(pageSelector);
  } else {
    await page.evaluate((p) => {
      if (typeof movePage === 'function') movePage(p);
      else if (typeof goPage === 'function') goPage(p);
      else if (typeof changePage === 'function') changePage(p);
      else {
        const btn = document.querySelector(`a.num[page="${p}"]`);
        if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        else throw new Error('페이지 이동 함수/버튼을 찾을 수 없음');
      }
    }, pageNum);
  }

  // 클릭 인식 대기 후 새 항목 출현까지 스마트 대기 (sleep(5000) 대비 4.5초 절약)
  await sleep(500);
  await page.waitForFunction(
    (sel) => document.querySelectorAll(sel).length > 0,
    { timeout: 30000 },
    itemSelector
  );
}
