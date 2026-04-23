// utils/browser.js
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { existsSync } from "fs";

const DEFAULT_PROTOCOL_TIMEOUT = Number(
  process.env.PUPPETEER_PROTOCOL_TIMEOUT || 240000
);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 공통 광고/추적 차단 호스트 목록
export const BLOCK_HOSTS = [
  'google-analytics.com', 'analytics.google.com', 'googletagmanager.com', 'google.com/ccm',
  'ad.danawa.com', 'dsas.danawa.com', 'service-api.flarelane.com', 'doubleclick.net',
  'adnxs.com', 'googlesyndication.com', 'scorecardresearch.com', 'facebook.net',
];

export async function getBrowserConfig() {
  const isCloudEnv = process.env.VERCEL === '1'
    || process.env.GITHUB_ACTIONS === 'true';

  if (isCloudEnv) {
    chromium.setGraphicsMode = false;
    const extraArgs = [
      '--single-process',              // 프로세스 공유로 메모리 절약
      '--disable-dev-shm-usage',       // /dev/shm 대신 /tmp 사용 (컨테이너 필수)
      '--js-flags=--max-old-space-size=256', // JS 힙 제한 256MB
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--no-first-run',
    ];
    const mergedArgs = [
      ...chromium.args,
      ...extraArgs.filter(a => !chromium.args.some(e => e.startsWith(a.split('=')[0]))),
    ];
    return {
      args: mergedArgs,
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

// 브라우저가 Network.enable 타임아웃 등으로 뻗었을 때 재시작 가능한 래퍼
export async function withBrowserPage(fn, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    let browser;
    try {
      browser = await launchBrowser();
      const page = await browser.newPage();
      const result = await fn(browser, page);
      return result;
    } catch (err) {
      const isProtocolError = err.message?.includes('Network.enable') || err.message?.includes('Protocol error') || err.message?.includes('Target closed');
      if (isProtocolError && attempt < retries) {
        console.warn(`⚠️ 브라우저 프로토콜 오류 (시도 ${attempt + 1}/${retries + 1}), 재시작...`);
        await sleep(3000);
      } else {
        throw err;
      }
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }
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

  await sleep(500);
  await page.waitForFunction(
    (sel) => document.querySelectorAll(sel).length > 0,
    { timeout: 30000 },
    itemSelector
  );
}
