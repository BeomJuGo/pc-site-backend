import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Cpu, Monitor, CircuitBoard, MemoryStick, HardDrive, Package, Wind, Zap } from "lucide-react";

const SLOTS = [
  { key: "cpu", label: "CPU", Icon: Cpu },
  { key: "gpu", label: "GPU", Icon: Monitor },
  { key: "motherboard", label: "메인보드", Icon: CircuitBoard },
  { key: "memory", label: "메모리", Icon: MemoryStick },
  { key: "storage", label: "저장장치", Icon: HardDrive },
  { key: "case", label: "케이스", Icon: Package },
  { key: "cooler", label: "쿨러", Icon: Wind },
  { key: "psu", label: "파워", Icon: Zap },
];

const BASE_SORT_OPTIONS = [
  { value: "price", label: "가격 낮은순" },
  { value: "price-desc", label: "가격 높은순" },
  { value: "name", label: "이름순" },
  { value: "mallCount", label: "인기순" },
];
const VALUE_SORT = { value: "value", label: "가성비순" };

function extractSocket(part) {
  const t = `${part.name || ""} ${part.info || ""} ${part.specSummary || ""}`.toUpperCase();
  if (/AM5/.test(t) || /B850|X870|A620|B650E|X670E|B650|X670/.test(t)) return "AM5";
  if (/AM4/.test(t) || /B550|X570|A520|B450|X470|B350|X370/.test(t)) return "AM4";
  if (/LGA\s?1851/.test(t) || /Z890|B860|H870/.test(t)) return "LGA1851";
  if (/LGA\s?1700/.test(t) || /Z790|B760|H770|Z690|B660|H610|H670/.test(t)) return "LGA1700";
  if (/LGA\s?1200/.test(t) || /Z590|B560|H570|Z490|B460|H410/.test(t)) return "LGA1200";
  if (/LGA\s?1151/.test(t) || /Z390|B360|H370|Z370|B250|H270|Z270/.test(t)) return "LGA1151";
  const m = t.match(/LGA\s?-?\s?(\d{3,4})/);
  if (m) return `LGA${m[1]}`;
  return "";
}

function extractDdr(part) {
  const t = `${part.name || ""} ${part.info || ""} ${part.specSummary || ""}`.toUpperCase();
  if (/DDR5/.test(t)) return "DDR5";
  if (/DDR4/.test(t)) return "DDR4";
  return "";
}

function extractBoardFF(board) {
  const t = `${board.name || ""} ${board.specSummary || ""}`.toUpperCase();
  if (/E-ATX|EATX/.test(t)) return "E-ATX";
  if (/MINI-ITX|MINI\s?ITX|\bITX\b/.test(t)) return "Mini-ITX";
  if (/MATX|MICRO-ATX|MICRO\s?ATX|M-ATX|\bMATX\b/.test(t)) return "mATX";
  if (/\bATX\b/.test(t)) return "ATX";
  return "";
}

function extractCaseFFs(caseItem) {
  const t = `${caseItem.name || ""} ${caseItem.specSummary || ""}`.toUpperCase();
  const ffs = [];
  if (/E-ATX|EATX/.test(t)) ffs.push("E-ATX");
  if (/\bATX\b/.test(t)) ffs.push("ATX");
  if (/MATX|MICRO-ATX|M-ATX/.test(t)) ffs.push("mATX");
  if (/MINI-ITX|ITX/.test(t)) ffs.push("Mini-ITX");
  return ffs.length ? ffs : ["ATX"];
}

function isCaseCompatible(boardFF, caseFFs) {
  if (!boardFF) return true;
  const order = ["Mini-ITX", "mATX", "ATX", "E-ATX"];
  const boardIdx = order.indexOf(boardFF);
  return caseFFs.some((ff) => order.indexOf(ff) >= boardIdx);
}

function extractTdpFromPart(part) {
  const t = `${part.name || ""} ${part.info || ""} ${part.specSummary || ""}`;
  const m = t.match(/TDP[:\s]*(\d+)\s*W/i) || t.match(/\b(\d{2,3})\s*W\b/i);
  return m ? parseInt(m[1]) : 0;
}

function extractPsuWatt(psu) {
  const m = (psu.name || "").match(/(\d{3,4})\s*W\b/i);
  return m ? parseInt(m[1]) : 0;
}

function runCompatibilityCheck(build) {
  const checks = [];
  const { cpu, gpu, motherboard, memory, psu, case: caseItem, cooler } = build;

  if (cpu && motherboard) {
    const cs = extractSocket(cpu);
    const bs = extractSocket(motherboard);
    if (!cs || !bs) {
      checks.push({ label: "소켓 호환", status: "warn", detail: "소켓 정보를 확인할 수 없습니다." });
    } else if (cs === bs) {
      checks.push({ label: "소켓 호환", status: "ok", detail: `${cs} ↔ ${bs}` });
    } else {
      checks.push({ label: "소켓 불일치", status: "error", detail: `CPU(${cs}) ↔ 메인보드(${bs}) — 호환되지 않습니다.` });
    }
  }

  if (memory && motherboard) {
    const md = extractDdr(memory);
    const bd = extractDdr(motherboard);
    if (md && bd) {
      if (md === bd) {
        checks.push({ label: "메모리 규격", status: "ok", detail: `${md} 호환` });
      } else {
        checks.push({ label: "메모리 규격 불일치", status: "error", detail: `RAM(${md}) ↔ 메인보드(${bd}) — 호환되지 않습니다.` });
      }
    }
  }

  if (motherboard && caseItem) {
    const boardFF = extractBoardFF(motherboard);
    const caseFFs = extractCaseFFs(caseItem);
    if (!boardFF) {
      checks.push({ label: "케이스 호환", status: "warn", detail: "메인보드 폼팩터를 확인할 수 없습니다." });
    } else if (isCaseCompatible(boardFF, caseFFs)) {
      checks.push({ label: "케이스 호환", status: "ok", detail: `메인보드(${boardFF}) ↔ 케이스(${caseFFs.join("/")})` });
    } else {
      checks.push({ label: "케이스 폼팩터 불일치", status: "error", detail: `메인보드(${boardFF})가 케이스(${caseFFs.join("/")})에 들어가지 않습니다.` });
    }
  }

  if (psu && (cpu || gpu)) {
    const cpuTdp = cpu ? extractTdpFromPart(cpu) : 0;
    const gpuTdp = gpu ? extractTdpFromPart(gpu) : 0;
    const sysTdp = cpuTdp + gpuTdp + 100;
    const psuW = extractPsuWatt(psu);
    if (psuW > 0 && sysTdp > 100) {
      const minRecommended = Math.round(sysTdp * 1.2);
      if (psuW >= minRecommended) {
        checks.push({ label: "파워 용량", status: "ok", detail: `${psuW}W ≥ 권장 ${minRecommended}W (시스템 ${sysTdp - 100}W + 여유 100W × 1.2)` });
      } else if (psuW >= sysTdp) {
        checks.push({ label: "파워 용량 부족 위험", status: "warn", detail: `${psuW}W — 권장 ${minRecommended}W 미만 (시스템 TDP ${sysTdp}W). 안정적 운용을 위해 더 높은 출력을 권장합니다.` });
      } else {
        checks.push({ label: "파워 용량 부족", status: "error", detail: `${psuW}W < 시스템 TDP ${sysTdp}W — 시스템을 정상 운용할 수 없습니다.` });
      }
    }
  }

  if (cooler && cpu) {
    const cpuSocket = extractSocket(cpu);
    const coolerText = `${cooler.name || ""} ${cooler.specSummary || ""}`.toUpperCase();
    if (cpuSocket) {
      const supported =
        (cpuSocket === "AM5" && /AM5/.test(coolerText)) ||
        (cpuSocket === "AM4" && /AM4/.test(coolerText)) ||
        (cpuSocket.startsWith("LGA") && new RegExp(cpuSocket.replace("LGA", "LGA\\s?")).test(coolerText));
      if (!supported && /AM[45]|LGA\s?\d{3,4}/.test(coolerText)) {
        checks.push({ label: "쿨러 소켓", status: "warn", detail: `쿨러가 CPU 소켓(${cpuSocket})을 지원하는지 확인하세요.` });
      } else if (supported) {
        checks.push({ label: "쿨러 소켓", status: "ok", detail: `${cpuSocket} 지원 확인` });
      }
    }
  }

  return checks;
}

function sortParts(parts, sortBy, category) {
  return [...parts].sort((a, b) => {
    if (sortBy === "price") return (Number(a.price) || 0) - (Number(b.price) || 0);
    if (sortBy === "price-desc") return (Number(b.price) || 0) - (Number(a.price) || 0);
    if (sortBy === "mallCount") return (Number(b.mallCount) || 0) - (Number(a.mallCount) || 0);
    if (sortBy === "value") {
      const score = (p) => category === "gpu"
        ? (Number(p.benchmarkScore?.["3dmarkscore"]) || 0)
        : (Number(p.benchmarkScore?.passmarkscore) || 0);
      const aV = a.price > 0 && score(a) > 0 ? score(a) / a.price : 0;
      const bV = b.price > 0 && score(b) > 0 ? score(b) / b.price : 0;
      return bV - aV;
    }
    return String(a.name).localeCompare(String(b.name));
  });
}

const STATUS_STYLE = {
  ok: { bar: "bg-green-500", text: "text-green-700", badge: "bg-green-50 border-green-200 text-green-700" },
  warn: { bar: "bg-yellow-500", text: "text-amber-700", badge: "bg-amber-50 border-amber-200 text-amber-700" },
  error: { bar: "bg-red-500", text: "text-red-600", badge: "bg-red-50 border-red-200 text-red-600" },
};

export default function PCBuilder() {
  const [build, setBuild] = useState({});
  const [modal, setModal] = useState(null);
  const [partsCache, setPartsCache] = useState({});
  const [loadingCat, setLoadingCat] = useState(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("price");
  const [copied, setCopied] = useState(false);
  const searchRef = useRef(null);

  const openModal = useCallback(async (slot) => {
    setModal(slot);
    setSearch("");
    setSortBy("price");
    if (!partsCache[slot.key]) {
      setLoadingCat(slot.key);
      try {
        const res = await fetch(`/api/parts?category=${slot.key}&limit=200`);
        const data = await res.json();
        setPartsCache((prev) => ({ ...prev, [slot.key]: data }));
      } catch {
        setPartsCache((prev) => ({ ...prev, [slot.key]: [] }));
      }
      setLoadingCat(null);
    }
  }, [partsCache]);

  useEffect(() => {
    document.title = "PC 견적 빌더 | 가성비PC";
  }, []);

  useEffect(() => {
    if (modal) setTimeout(() => searchRef.current?.focus(), 50);
  }, [modal]);

  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") setModal(null); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const selectPart = (part) => {
    setBuild((prev) => ({ ...prev, [modal.key]: part }));
    setModal(null);
  };

  const removePart = (key, e) => {
    e.stopPropagation();
    setBuild((prev) => { const n = { ...prev }; delete n[key]; return n; });
  };

  const totalPrice = Object.values(build).reduce((s, p) => s + (Number(p?.price) || 0), 0);
  const partCount = Object.keys(build).length;

  const compatibilityChecks = useMemo(() => {
    if (partCount < 2) return [];
    return runCompatibilityCheck(build);
  }, [build, partCount]);

  const hasError = compatibilityChecks.some((c) => c.status === "error");
  const hasWarn = compatibilityChecks.some((c) => c.status === "warn");

  const handleShare = async () => {
    const lines = SLOTS.map(({ key, label }) => {
      const p = build[key];
      return p ? `${label}: ${p.name} (${Number(p.price).toLocaleString()}원)` : null;
    }).filter(Boolean);
    if (!lines.length) return;
    const text = `[가성비PC 견적]\n${lines.join("\n")}\n총합: ${totalPrice.toLocaleString()}원`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert(text);
    }
  };

  const sortOptions = modal
    ? (["cpu", "gpu"].includes(modal.key) ? [...BASE_SORT_OPTIONS, VALUE_SORT] : BASE_SORT_OPTIONS)
    : BASE_SORT_OPTIONS;

  const rawParts = modal ? (partsCache[modal.key] || []) : [];
  const filtered = rawParts.filter((p) =>
    String(p.name || "").toLowerCase().includes(search.toLowerCase())
  );
  const sorted = sortParts(filtered, sortBy, modal?.key);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">🛠️ 직접 견적 짜기</h1>
        <p className="text-gray-500">원하는 부품을 직접 선택해 나만의 PC 견적을 구성하세요.</p>
      </div>

      {/* Build slots */}
      <div className="border border-gray-200 rounded-2xl bg-white overflow-hidden divide-y divide-gray-100 mb-4 shadow-sm">
        {SLOTS.map(({ key, label, Icon }) => {
          const part = build[key];
          return (
            <div
              key={key}
              onClick={() => openModal({ key, label })}
              className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors group"
            >
              <span className="w-8 flex justify-center flex-shrink-0">
                <Icon className="w-5 h-5 text-gray-400 group-hover:text-blue-500 transition-colors" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-gray-400 mb-0.5">{label}</div>
                {part ? (
                  <div className="flex items-center gap-2 min-w-0">
                    {part.image && (
                      <img src={part.image} alt="" className="w-8 h-8 object-contain rounded flex-shrink-0" />
                    )}
                    <span className="text-sm text-gray-900 truncate">{part.name}</span>
                  </div>
                ) : (
                  <span className="text-sm text-gray-400 group-hover:text-gray-600 transition-colors">
                    클릭하여 선택
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {part && (
                  <>
                    <span className="text-sm font-semibold text-gray-900">
                      {Number(part.price).toLocaleString()}원
                    </span>
                    <button
                      onClick={(e) => removePart(key, e)}
                      className="text-gray-400 hover:text-red-500 transition-colors text-lg leading-none"
                      title="제거"
                    >
                      ×
                    </button>
                  </>
                )}
                {!part && (
                  <svg className="w-5 h-5 text-gray-300 group-hover:text-gray-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Compatibility check */}
      {compatibilityChecks.length > 0 && (
        <div className={`border rounded-xl px-5 py-4 mb-4 ${
          hasError ? "bg-red-50 border-red-200" :
          hasWarn ? "bg-amber-50 border-amber-200" :
          "bg-green-50 border-green-200"
        }`}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-semibold text-gray-900">호환성 체크</span>
            <span className={`text-xs px-2 py-0.5 rounded-full border ${
              hasError ? STATUS_STYLE.error.badge :
              hasWarn ? STATUS_STYLE.warn.badge :
              STATUS_STYLE.ok.badge
            }`}>
              {hasError ? "문제 있음" : hasWarn ? "주의 필요" : "모두 호환"}
            </span>
          </div>
          <div className="space-y-2">
            {compatibilityChecks.map((c, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${STATUS_STYLE[c.status].bar}`} />
                <div className="min-w-0">
                  <span className={`text-xs font-medium ${STATUS_STYLE[c.status].text}`}>{c.label}: </span>
                  <span className="text-xs text-gray-600">{c.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Total bar */}
      <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 flex items-center justify-between mb-4 shadow-sm">
        <div>
          <span className="text-gray-500 text-sm">총 견적</span>
          {partCount > 0 && (
            <span className="ml-2 text-xs text-gray-400">({partCount}/8 부품)</span>
          )}
        </div>
        <span className="text-2xl font-bold text-gray-900">{totalPrice.toLocaleString()}원</span>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleShare}
          disabled={partCount === 0}
          className="flex-1 py-2.5 text-sm font-medium rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {copied ? "✅ 복사됨!" : "📋 견적 복사"}
        </button>
        <button
          onClick={() => setBuild({})}
          disabled={partCount === 0}
          className="px-4 py-2.5 text-sm font-medium rounded-xl border border-gray-300 text-gray-500 hover:text-gray-900 hover:border-gray-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          초기화
        </button>
      </div>

      {/* Part selection modal */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setModal(null)}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl border border-gray-200 shadow-2xl flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-3 flex-shrink-0">
              <h2 className="text-lg font-bold text-gray-900 flex-1">{modal.label} 선택</h2>
              <button
                onClick={() => setModal(null)}
                className="text-gray-400 hover:text-gray-900 transition-colors text-2xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="px-4 py-3 border-b border-gray-200 flex gap-2 flex-shrink-0">
              <input
                ref={searchRef}
                type="text"
                placeholder="제품명 검색"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 px-3 py-2 text-sm rounded-lg bg-white border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-2 py-2 text-sm rounded-lg bg-white border border-gray-300 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {sortOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="overflow-y-auto flex-1">
              {loadingCat === modal.key ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : sorted.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">
                  {search ? "검색 결과가 없습니다." : "부품을 불러오는 중..."}
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {sorted.slice(0, 100).map((part, i) => (
                    <button
                      key={part._id || part.name || i}
                      onClick={() => selectPart(part)}
                      className={`w-full flex items-center gap-4 px-5 py-3.5 text-left hover:bg-gray-50 transition-colors ${
                        build[modal.key]?.name === part.name ? "bg-blue-50 border-l-2 border-blue-600" : ""
                      }`}
                    >
                      {part.image && (
                        <img src={part.image} alt="" className="w-10 h-10 object-contain rounded flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-900 truncate">{part.name}</div>
                        {part.specSummary && (
                          <div className="text-xs text-gray-400 truncate mt-0.5">{part.specSummary}</div>
                        )}
                      </div>
                      <div className="text-sm font-semibold text-gray-900 flex-shrink-0">
                        {part.price > 0 ? `${Number(part.price).toLocaleString()}원` : "가격 미정"}
                      </div>
                    </button>
                  ))}
                  {sorted.length > 100 && (
                    <div className="px-5 py-3 text-xs text-gray-400 text-center">
                      검색어로 범위를 좁혀주세요 ({sorted.length}개 중 100개 표시)
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
