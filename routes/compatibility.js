// routes/compatibility.js - 호환성 자동 검사 (Feature 4)
import express from "express";
import { getDB } from "../db.js";

const router = express.Router();

function normalizeSocket(s = "") {
  const n = s.toUpperCase().replace(/\s+/g, "").replace(/-/g, "");
  if (/LGA115[01X]/.test(n)) return "LGA115X";
  return n;
}

function extractSocket(text = "") {
  const t = text.toUpperCase();
  const m = text.match(/Socket:?\s*(AM[45]|sTRX4|TR4|SP3|LGA[\s\d-]+)/i);
  if (m) return normalizeSocket(m[1]);
  if (/B850|X870|AM5|B650|X670|A620|B850E|X870E/.test(t)) return "AM5";
  if (/AM4|B550|X570|A520|B450|X470|B350|X370/.test(t)) return "AM4";
  if (/Z890|B860|H870|LGA1851/.test(t)) return "LGA1851";
  if (/Z790|B760|H770|Z690|B660|H610|H670|LGA1700/.test(t)) return "LGA1700";
  if (/Z590|B560|H570|Z490|B460|H410|LGA1200/.test(t)) return "LGA1200";
  if (/Z390|B360|H370|Z370|B250|H270|Z270|LGA1151/.test(t)) return "LGA1151";
  const lga = t.match(/LGA(\d{3,4})/);
  if (lga) return `LGA${lga[1]}`;
  return "";
}

function extractDdr(text = "") {
  const m = text.toUpperCase().match(/DDR([45])/);
  return m ? `DDR${m[1]}` : "";
}

function extractWatt(text = "") {
  const m = text.match(/(\d{2,4})\s*W/i);
  return m ? parseInt(m[1]) : 0;
}

// POST /api/compatibility/check
// body: { parts: { cpu, gpu, motherboard, memory, psu, cooler, storage, case } } (부품 이름 문자열)
router.post("/check", async (req, res) => {
  try {
    const { parts } = req.body;
    if (!parts || typeof parts !== "object")
      return res.status(400).json({ error: "parts 객체가 필요합니다. { cpu: '이름', gpu: '이름', ... }" });

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
      const cpuSocket = extractSocket(`${docs.cpu.name} ${docs.cpu.info || ""} ${docs.cpu.specSummary || ""}`);
      const boardSocket = extractSocket(`${docs.motherboard.name} ${docs.motherboard.info || ""} ${docs.motherboard.specSummary || ""}`);
      info.cpuSocket = cpuSocket;
      info.boardSocket = boardSocket;
      if (cpuSocket && boardSocket && normalizeSocket(cpuSocket) !== normalizeSocket(boardSocket))
        issues.push(`\uc18c\ucf13 \ubd88\uc77c\uce58: CPU(${cpuSocket}) \u2194 \uba54\uc778\ubcf4\ub4dc(${boardSocket})`);
    }

    // 2. 메인보드 ↔ 메모리 DDR
    if (docs.motherboard && docs.memory) {
      const boardDdr = extractDdr(`${docs.motherboard.name} ${docs.motherboard.info || ""}`);
      const memDdr = extractDdr(`${docs.memory.name} ${docs.memory.info || ""}`);
      info.boardDdr = boardDdr;
      info.memDdr = memDdr;
      if (boardDdr && memDdr && boardDdr !== memDdr)
        issues.push(`\uba54\ubaa8\ub9ac \uaddc\uaca9 \ubd88\uc77c\uce58: \uba54\uc778\ubcf4\ub4dc(${boardDdr}) \u2194 \uba54\ubaa8\ub9ac(${memDdr})`);
    }

    // 3. PSU 전력 충분 여부
    if (docs.psu) {
      const psuWatt = extractWatt(`${docs.psu.name} ${docs.psu.info || ""}`);
      let tdp = 100;
      if (docs.cpu) tdp += extractWatt(`${docs.cpu.info || ""} ${docs.cpu.specSummary || ""}`) || 65;
      if (docs.gpu) tdp += extractWatt(`${docs.gpu.info || ""} ${docs.gpu.specSummary || ""}`) || 150;
      info.psuWatt = psuWatt;
      info.estimatedTdp = tdp;
      if (psuWatt > 0) {
        if (psuWatt < tdp)
          issues.push(`\uc804\ub825 \ubd80\uc871: PSU(${psuWatt}W) < \uc608\uc0c1 \uc18c\ube44\uc804\ub825(${tdp}W)`);
        else if (psuWatt < tdp * 1.2)
          warnings.push(`PSU \uc5ec\uc720 \ubd80\uc871: ${psuWatt}W (\uc2e4vc 20% \uc5ec\uc720 \uc2dc ${Math.ceil(tdp * 1.2)}W \uc774\uc0c1 \uc6c8\uc7a5)`);
      }
    }

    // 4. 쿨러 ↔ CPU 소켓
    if (docs.cooler && info.cpuSocket) {
      const sockets = docs.cooler.specs?.sockets || [];
      if (sockets.length > 0 && !sockets.some(s => normalizeSocket(s) === normalizeSocket(info.cpuSocket)))
        issues.push(`\ucfe8\ub7ec \uc18c\ucf13 \ubd88\uc77c\uce58: \uc9c0\uc6d0(${sockets.join(", ")}) \u2194 CPU(${info.cpuSocket})`);
    }

    // 5. 케이스 ↔ 메인보드 폼팩터
    if (docs.case && docs.motherboard) {
      const caseFF = docs.case.specs?.formFactor || [];
      const boardText = `${docs.motherboard.name} ${docs.motherboard.info || ""}`.toUpperCase();
      const boardFF = /E-?ATX/.test(boardText) ? "E-ATX"
        : /M-?ATX|MATX|MICRO/.test(boardText) ? "mATX"
        : /ITX/.test(boardText) ? "Mini-ITX" : "ATX";
      info.boardFormFactor = boardFF;
      if (caseFF.length > 0 && !caseFF.includes(boardFF))
        issues.push(`\ud3fc\ud329\ud130 \ubd88\uc77c\uce58: \ucf00\uc774\uc2a4 \uc9c0\uc6d0(${caseFF.join(", ")}) \u2194 \uba54\uc778\ubcf4\ub4dc(${boardFF})`);
    }

    const compatible = issues.length === 0;
    res.json({
      compatible,
      issues,
      warnings,
      info,
      summary: compatible
        ? (warnings.length > 0 ? "\ud638\ud658 \uac00\ub2a5 (\uc8fc\uc758\uc0ac\ud56d \uc788\uc74c)" : "\ubaa8\ub4e0 \ubd80\ud488\uc774 \ud638\ud658\ub429\ub2c8\ub2e4.")
        : `${issues.length}\uac1c\uc758 \ud638\ud658\uc131 \ubb38\uc81c\uac00 \ubc1c\uacac\ub418\uc5c8\uc2b5\ub2c8\ub2e4.`,
    });
  } catch (err) {
    console.error("\u274C \ud638\ud658\uc131 \uac80\uc0ac \uc2e4\ud328:", err);
    res.status(500).json({ error: "\ud638\ud658\uc131 \uac80\uc0ac \uc2e4\ud328" });
  }
});

export default router;
