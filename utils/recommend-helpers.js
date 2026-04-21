// utils/recommend-helpers.js
import logger from "./logger.js";
import { invalidatePrefix } from "./responseCache.js";

const _partsCache = { data: null, ts: 0 };
const CACHE_TTL = 5 * 60 * 1000;

export async function loadParts(db) {
  if (_partsCache.data && Date.now() - _partsCache.ts < CACHE_TTL) {
    return _partsCache.data;
  }
  const col = db.collection("parts");
  const projection = { name: 1, price: 1, image: 1, benchmarkScore: 1, specSummary: 1, info: 1, category: 1, manufacturer: 1, specs: 1 };
  const [cpus, gpus, memories, boards, psus, coolers, storages, cases] = await Promise.all([
    col.find({ category: "cpu",         price: { $gt: 0 } }, { projection }).toArray(),
    col.find({ category: "gpu",         price: { $gt: 0 } }, { projection }).toArray(),
    col.find({ category: "memory",      price: { $gt: 0 } }, { projection }).toArray(),
    col.find({ category: "motherboard", price: { $gt: 0 } }, { projection }).toArray(),
    col.find({ category: "psu",         price: { $gt: 0 } }, { projection }).toArray(),
    col.find({ category: "cooler",      price: { $gt: 0 } }, { projection }).toArray(),
    col.find({ category: "storage",     price: { $gt: 0 } }, { projection }).toArray(),
    col.find({ category: "case",        price: { $gt: 0 } }, { projection }).toArray(),
  ]);
  _partsCache.data = { cpus, gpus, memories, boards, psus, coolers, storages, cases };
  _partsCache.ts = Date.now();
  logger.info(`부품 DB 로드 완료 (CPU:${cpus.length}, GPU:${gpus.length}, MEM:${memories.length}, BOARD:${boards.length})`);
  return _partsCache.data;
}

export function invalidatePartsCache() {
  _partsCache.data = null;
  _partsCache.ts = 0;
  invalidatePrefix("parts:");
  logger.info("부품 캐시 무효화 완료");
}

export function extractBoardFormFactor(board) {
  const text = `${board.name || ""} ${board.info || ""} ${board.specSummary || ""}`.toUpperCase();
  if (/E-?ATX|EATX/.test(text)) return "E-ATX";
  if (/MINI-?ITX|M-?ITX(?!X)|\bITX\b/.test(text)) return "Mini-ITX";
  if (/M-?ATX|MATX|MICRO.?ATX/.test(text)) return "mATX";
  return "ATX";
}

export function isCaseCompatible(caseItem, boardFormFactor) {
  const supported = caseItem.specs?.formFactor;
  if (!Array.isArray(supported) || supported.length === 0) return true;
  return supported.includes(boardFormFactor);
}
