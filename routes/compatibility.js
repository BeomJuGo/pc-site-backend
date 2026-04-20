// routes/compatibility.js - 호환성 자동 검사 (Feature 4)
import express from "express";
import { getDB } from "../db.js";

const router = express.Router();

const CHIPSET_SOCKET_MAP = {
  B850: "AM5", X870: "AM5", "B850E": "AM5", "X870E": "AM5",
  B650: "AM5", X670: "AM5", "B650E": "AM5", "X670E": "AM5", A620: "AM5",
  B550: "AM4", X570: "AM4", A520: "AM4", B450: "AM4",
  X470: "AM4", B350: "AM4", X370: "AM4", A320: "AM4",
  Z890: "LGA1851", B860: "LGA1851", H870: "LGA1851",
  Z790: "LGA1700", B760: "LGA1700", H770: "LGA1700",
  Z690: "LGA1700", B660: "LGA1700", H610: "LGA1700", H670: "LGA1700",
  Z590: "LGA1200", B560: "LGA1200", H570: "LGA1200",
  Z490: "LGA1200", B460: "LGA1200", H410: "LGA1200",
  Z390: "LGA1151", B360: "LGA1151", H370: "LGA1151",
  Z370: "LGA1151", B250: "LGA1151", H270: "LGA1151", Z270: "LGA1151",
};

const GPU_TDP_TIERS = [
  { re: /RTX\s*50[89]0|RX\s*9900/i, w: 400 },
  { re: /RTX\s*5080|RX\s*9800/i, w: 320 },
  { re: /RTX\s*5070\s*Ti|RTX\s*4090|RX\s*9700/i, w: 285 },
  { re: /RTX\s*5070|RTX\s*4080/i, w: 250 },
  { re: /RTX\s*5060\s*Ti|RTX\s*4070\s*Ti/i, w: 220 },
  { re: /RTX\s*4070\s*Super|RTX\s*4070(?!\s*Ti)/i, w: 200 },
  { re: /RTX\s*4060\s*Ti|RX\s*7900/i, w: 165 },
  { re: /RTX\s*4060|RX\s*7800|RX\s*7700/i, w: 115 },
  { re: /RX\s*7600|RTX\s*3090|RTX\s*3080/i, w: 330 },
  { re: /RTX\s*3070/i, w: 220 },
  { re: /RTX\s*3060/i, w: 170 },
];

const CPU_TDP_TIERS = [
  { re: /i9-1[3-9]\d{3}K|Ryzen\s*9\s*[79]\d{3}X3D/i, w: 150 },
  { re: /i9-1[0-2]\d{3}|Ryzen\s*9\s*[79]\d{3}/i, w: 125 },
  { re: /i7-1[3-9]\d{3}K|Ryzen\s*7\s*\d{4}X/i, w: 105 },
  { re: /i7-1[0-2]\d{3}|Ryzen\s*7\s*\d{4}/i, w: 95 },
  { re: /i5-1[3-9]\d{3}K|Ryzen\s*5\s*\d{4}X/i, w: 90 },
  { re: /i5-|Ryzen\s*5/i, w: 65 },
];

function guessTdp(tiers, text) {
  for (const { re, w } of tiers) {
    if (re.test(text)) return w;
  }
  return null;
}

function normalizeSocket(s = "") {
  return s.toUpperCase().replace(/[\s-]/g, "");
}

function extractSocket(name = "", info = "", specSummary = "") {
  const combined = `${name} ${info} ${specSummary}`;
  const upper = combined.toUpperCase().replace(/\s+/g, "");

  const explicit = combined.match(/[Ss]ocket:?\s*(AM[345]|sTRX4|TR4|SP3|LGA[\s\d-]+)/i);
  if (explicit) return normalizeSocket(explicit[1]);

  if (upper.includes("LGA1851")) return "LGA1851";
  if (upper.includes("LGA1700")) return "LGA1700";
  if (upper.includes("LGA1200")) return "LGA1200";
  if (/LGA115[0-9X]/.test(upper)) return "LGA1151";
  if (upper.includes("AM5")) return "AM5";
  if (upper.includes("AM4")) return "AM4";

  for (const [chipset, socket] of Object.entries(CHIPSET_SOCKET_MAP)) {
    const re = new RegExp(`(?<![A-Z0-9])${chipset}(?![A-Z0-9])`, "i");
    if (re.test(combined)) return socket;
  }

  const lgaM = upper.match(/LGA(\d{3,4})/);
  if (lgaM) return `LGA${lgaM[1]}`;

  return "";
}

function extractDdr(text = "") {
  const m = text.toUpperCase().match(/DDR\s*([45])/);
  return m ? `DDR${m[1]}` : "";
}

function extractWatt(text = "") {
  const m = text.match(/(\d{2,4})\s*W(?:att)?/i);
  return m ? parseInt(m[1]) : 0;
}

function detectFormFactor(text = "") {
  const t = text.toUpperCase().replace(/[\s-]/g, "");
  if (/EATX/.test(t)) return "E-ATX";
  if (/MINIITX/.test(t)) return "Mini-ITX";
  if (/MICROATX|MATX/.test(t)) return "mATX";
  if (/ATX/.test(t)) return "ATX";
  return "";
}

// POST /api/compatibility/check
router.post("/check", async (req, res) => {
  try {
    const { parts } = req.body;
    if (!parts || typeof parts !== "object")
      return res.status(400).json({ error: "parts \uac1d\uccb4\uac00 \ud544\uc694\ud569\ub2c8\ub2e4. { cpu: '\uc774\ub984', gpu: '\uc774\ub984', ... }" });

    const db = getDB();
    const issues = [];
    const warnings = [];
    const info = {};

    const cats = ["cpu", "gpu", "motherboard", "memory", "psu", "cooler", "storage", "case"];
    const docs = {};
    await Promise.all(
      cats.map(async (cat) => {
        if (!parts[cat]) return;
        docs[cat] = await db.collection("parts").findOne(
          { category: cat, name: parts[cat] },
          { projection: { name: 1, info: 1, specSummary: 1, specs: 1 } }
        );
      })
    );

    // 1. CPU ↔ 메인보드 소켓
    if (docs.cpu && docs.motherboard) {
      const cpuSocket = docs.cpu.specs?.socket
        ? normalizeSocket(docs.cpu.specs.socket)
        : extractSocket(docs.cpu.name, docs.cpu.info || "", docs.cpu.specSummary || "");
      const boardSocket = docs.motherboard.specs?.socket
        ? normalizeSocket(docs.motherboard.specs.socket)
        : extractSocket(docs.motherboard.name, docs.motherboard.info || "", docs.motherboard.specSummary || "");
      info.cpuSocket = cpuSocket;
      info.boardSocket = boardSocket;
      if (cpuSocket && boardSocket && normalizeSocket(cpuSocket) !== normalizeSocket(boardSocket))
        issues.push(`\uc18c\ucf13 \ubd88\uc77c\uce58: CPU(${cpuSocket}) \u2194 \uba54\uc778\ubcf4\ub4dc(${boardSocket})`);
    }

    // 2. 메인보드 ↔ 메모리 DDR
    if (docs.motherboard && docs.memory) {
      const boardDdr = extractDdr(`${docs.motherboard.name} ${docs.motherboard.info || ""} ${docs.motherboard.specSummary || ""}`);
      const memDdr = extractDdr(`${docs.memory.name} ${docs.memory.info || ""}`);
      info.boardDdr = boardDdr;
      info.memDdr = memDdr;
      if (boardDdr && memDdr && boardDdr !== memDdr)
        issues.push(`\uba54\ubaa8\ub9ac \uaddc\uaca9 \ubd88\uc77c\uce58: \uba54\uc778\ubcf4\ub4dc(${boardDdr}) \u2194 \uba54\ubaa8\ub9ac(${memDdr})`);
    }

    // 3. PSU 전력 충분 여부 (TDP 티어 테이블 기반 추정)
    if (docs.psu) {
      const psuWatt = extractWatt(`${docs.psu.name} ${docs.psu.info || ""}`);
      let tdp = 80;
      const cpuText = `${docs.cpu?.name || ""} ${docs.cpu?.info || ""} ${docs.cpu?.specSummary || ""}`;
      const gpuText = `${docs.gpu?.name || ""} ${docs.gpu?.info || ""} ${docs.gpu?.specSummary || ""}`;
      tdp += (guessTdp(CPU_TDP_TIERS, cpuText) ?? extractWatt(cpuText)) || 65;
      tdp += (guessTdp(GPU_TDP_TIERS, gpuText) ?? extractWatt(gpuText)) || 150;
      info.psuWatt = psuWatt;
      info.estimatedTdp = tdp;
      if (psuWatt > 0) {
        if (psuWatt < tdp)
          issues.push(`\uc804\ub825 \ubd80\uc871: PSU(${psuWatt}W) < \uc608\uc0c1 \uc18c\ube44\uc804\ub825(${tdp}W)`);
        else if (psuWatt < Math.ceil(tdp * 1.2))
          warnings.push(`PSU \uc5ec\uc720 \ubd80\uc871: ${psuWatt}W (\uc2e4\uc0ac 20% \uc5ec\uc720 \uc2dc ${Math.ceil(tdp * 1.2)}W \uc774\uc0c1 \uad8c\uc7a5)`);
      }
    }

    // 4. 쿨러 ↔ CPU 소켓
    if (docs.cooler && info.cpuSocket) {
      const sockets = docs.cooler.specs?.sockets || [];
      if (sockets.length > 0 && !sockets.some((s) => normalizeSocket(s) === normalizeSocket(info.cpuSocket)))
        issues.push(`\ucfe8\ub7ec \uc18c\ucf13 \ubd88\uc77c\uce58: \uc9c0\uc6d0(${sockets.join(", ")}) \u2194 CPU(${info.cpuSocket})`);
    }

    // 5. 케이스 ↔ 메인보드 폼팩터
    if (docs.case && docs.motherboard) {
      const caseFF = docs.case.specs?.formFactor || [];
      const boardFF = docs.motherboard.specs?.formFactor
        || detectFormFactor(`${docs.motherboard.name} ${docs.motherboard.info || ""} ${docs.motherboard.specSummary || ""}`);
      info.boardFormFactor = boardFF;
      if (caseFF.length > 0 && boardFF && !caseFF.includes(boardFF))
        issues.push(`\ud3fc\ud329\ud130 \ubd88\uc77c\uce58: \ucf00\uc774\uc2a4 \uc9c0\uc6d0(${caseFF.join(", ")}) \u2194 \uba54\uc778\ubcf4\ub4dc(${boardFF})`);
    }

    const compatible = issues.length === 0;
    res.json({
      compatible,
      issues,
      warnings,
      info,
      summary: compatible
        ? warnings.length > 0 ? "\ud638\ud658 \uac00\ub2a5 (\uc8fc\uc758\uc0ac\ud56d \uc788\uc74c)" : "\ubaa8\ub4e0 \ubd80\ud488\uc774 \ud638\ud658\ub429\ub2c8\ub2e4."
        : `${issues.length}\uac1c\uc758 \ud638\ud658\uc131 \ubb38\uc81c\uac00 \ubc1c\uacac\ub418\uc5c8\uc2b5\ub2c8\ub2e4.`,
    });
  } catch (err) {
    console.error("\u274C \ud638\ud658\uc131 \uac80\uc0ac \uc2e4\ud328:", err);
    res.status(500).json({ error: "\ud638\ud658\uc131 \uac80\uc0ac \uc2e4\ud328" });
  }
});

export default router;
