// utils/recommend-helpers.js
// \ucd94\ucccd \uc54c\uace0\ub9ac\uc998 \uc720\ud2f8\ub9ac\ud2f0: \uc778\uba54\ubaa8\ub9ac \uce90\uc2dc + \ucf00\uc774\uc2a4 \ud3fc\ud329\ud130 \ud638\ud658\uc131

const _partsCache = { data: null, ts: 0 };
const CACHE_TTL = 5 * 60 * 1000;

export async function loadParts(db) {
  if (_partsCache.data && Date.now() - _partsCache.ts < CACHE_TTL) {
    console.log("\uD83D\uDCE6 \uce90\uc2dc\uc5d0\uc11c \ubd80\ud488 \ub370\uc774\ud130 \ub85c\ub4dc");
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
  console.log(`\uD83D\uDCE6 DB \ub85c\ub4dc \uc644\ub8cc (CPU:${cpus.length}, GPU:${gpus.length}, MEM:${memories.length}, BOARD:${boards.length}, PSU:${psus.length}, COOLER:${coolers.length}, STORAGE:${storages.length}, CASE:${cases.length})`);
  return _partsCache.data;
}

export function invalidatePartsCache() {
  _partsCache.data = null;
  _partsCache.ts = 0;
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
