// LEGACY — budget-set AI 전환 전 스냅샷 (2026-04-22)
// 이 파일은 백업용입니다. index.js에서 import하지 않습니다.

import express from "express";
import { getDB } from "../db.js";
import config from "../config.js";
import { loadParts, extractBoardFormFactor, isCaseCompatible } from "../utils/recommend-helpers.js";
import logger from "../utils/logger.js";
import { validate } from "../middleware/validate.js";
import { recommendSchema } from "../schemas/recommend.js";
import { makeAiCacheKey, getOrComputeRecommendation } from "../utils/aiCache.js";
import { upgradeAdvisorSchema } from "../schemas/recommend.js";
import { getCache, setCache } from "../utils/responseCache.js";

const OPENAI_API_KEY = config.openaiApiKey;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const router = express.Router();

const buildingInProgress = new Set();

/* ==================== util ==================== */

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findPartForUpgrade(db, category, rawName) {
  if (!rawName) return null;
  const name = rawName.trim();
  const proj = { projection: { name: 1, price: 1, benchmarkScore: 1 } };
  let part = await db.collection("parts").findOne({ category, name }, proj);
  if (part) return part;
  const escaped = escapeRegex(name);
  part = await db.collection("parts").findOne({ category, name: { $regex: escaped, $options: "i" } }, proj);
  return part || null;
}

function normalizeSocket(socket) {
  if (!socket) return "";
  const s = socket.toUpperCase().replace(/\s+/g, "").replace(/-/g, "");
  if (/LGA115[0-1X]/.test(s)) return "LGA115X";
  return s;
}

function extractCpuSocket(cpu) {
  const text = `${cpu.name || ""} ${cpu.info || ""} ${cpu.specSummary || ""}`;
  const combined = text.toUpperCase();
  let m = text.match(/Socket:?\s*(AM[45]|sTRX4|TR4|SP3|LGA\s*[\d-]+)/i);
  if (m) return normalizeSocket(m[1]);
  m = text.match(/(?:소켓\s*)?(LGA\s*[\d-]+|AM[45]|sTRX4|TR4|SP3)(?:\s*소켓)?/i);
  if (m) return normalizeSocket(m[1]);
  m = text.match(/(AM[45]|sTRX4|TR4|SP3|LGA\s*[\d-]+|LGA\d{3,4})/i);
  if (m) return normalizeSocket(m[1]);
  if (/인텔|INTEL/i.test(text)) {
    if (/14세대|13세대|12세대|\b(14|13|12)\s*GEN|랙터레이크|RAPTOR|앨더레이크|ALDER/i.test(combined)) return "LGA1700";
    if (/11세대|10세대|\b(11|10)\s*GEN|로켓레이크|ROCKET|코멧레이크|COMET/i.test(combined)) return "LGA1200";
    if (/9세대|8세대|\b(9|8)\s*GEN|커피레이크|COFFEE/i.test(combined)) return "LGA1151";
    const mm = combined.match(/\b(1[0-4]\d{3}[A-Z]*)\b/);
    if (mm) {
      const n = parseInt(mm[1].substring(0, 2));
      if (n >= 12 && n <= 14) return "LGA1700";
      if (n >= 10 && n <= 11) return "LGA1200";
      if (n >= 6 && n <= 9) return "LGA1151";
    }
  }
  return "";
}

function extractBoardSocket(board) {
  const text = `${board.name || ""} ${board.info || ""} ${board.specSummary || ""}`;
  const combined = text.toUpperCase();
  let m = text.match(/Socket:?\s*(AM[45]|sTRX4|TR4|SP3|LGA\s*[\d-]+)/i);
  if (m) return normalizeSocket(m[1]);
  m = text.match(/(?:소켓\s*)?(LGA\s*[\d-]+|AM[45]|sTRX4|TR4|SP3)(?:\s*소켓)?/i);
  if (m) return normalizeSocket(m[1]);
  m = text.match(/(AM[45]|sTRX4|TR4|SP3|LGA\s*[\d-]+|LGA\d{3,4})/i);
  if (m) return normalizeSocket(m[1]);
  if (/B850|X870|A850|B850E|X870E|AM5|B650|X670|A620|B650E|X670E/i.test(combined)) return "AM5";
  if (/AM4|B550|X570|A520|B450|X470|B350|X370/i.test(combined)) return "AM4";
  if (/Z890|B860|H870|LGA\s?1851/i.test(combined)) return "LGA1851";
  if (/Z790|B760|H770|Z690|B660|H610|H670|LGA\s?1700/i.test(combined)) return "LGA1700";
  if (/Z590|B560|H570|Z490|B460|H410|LGA\s?1200/i.test(combined)) return "LGA1200";
  if (/Z390|B360|H370|Z370|B250|H270|Z270|B150|H170|Z170|LGA\s?1151/i.test(combined)) return "LGA1151";
  const lga = combined.match(/LGA\s?-?\s?(\d{3,4})/i);
  if (lga) return `LGA${lga[1]}`;
  return "";
}

export default router;
