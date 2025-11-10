// utils/browser.js - Puppeteer 브라우저 설정 헬퍼
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { existsSync } from "fs";

const DEFAULT_PROTOCOL_TIMEOUT = Number(
  process.env.PUPPETEER_PROTOCOL_TIMEOUT || 240000
);

/**
 * 환경에 맞는 Puppeteer 브라우저 설정 반환
 * 로컬 개발: Windows Chrome 경로 사용
 * Render/프로덕션: @sparticuz/chromium 사용
 */
export async function getBrowserConfig() {
  const isRender = process.env.RENDER === 'true' || process.env.RENDER_SERVICE_NAME || process.env.RENDER_EXTERNAL_URL;
  const isProduction = process.env.NODE_ENV === 'production';

  // Render 환경이면 항상 chromium 사용
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

  // 로컬 개발 환경: Windows Chrome 경로 확인
  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  if (existsSync(chromePath)) {
    return {
      executablePath: chromePath,
      args: [
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor'
      ],
      defaultViewport: { width: 1280, height: 720 },
      headless: true,
      ignoreHTTPSErrors: true,
      protocolTimeout: DEFAULT_PROTOCOL_TIMEOUT,
    };
  }

  // Chrome이 없으면 chromium 사용 (프로덕션 환경 또는 Chrome이 없는 경우)
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

/**
 * Puppeteer 브라우저 실행 (환경에 맞게 자동 설정)
 */
export async function launchBrowser() {
  const config = await getBrowserConfig();
  return await puppeteer.launch(config);
}

