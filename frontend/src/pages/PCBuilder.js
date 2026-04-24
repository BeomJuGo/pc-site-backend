import { useState, useEffect, useCallback, useRef } from "react";

const SLOTS = [
  { key: "cpu", label: "CPU", icon: "🖥️" },
  { key: "gpu", label: "GPU", icon: "🎮" },
  { key: "motherboard", label: "메인보드", icon: "🔌" },
  { key: "memory", label: "메모리", icon: "💾" },
  { key: "storage", label: "저장장치", icon: "💿" },
  { key: "case", label: "케이스", icon: "📦" },
  { key: "cooler", label: "쿨러", icon: "❄️" },
  { key: "psu", label: "파워", icon: "⚡" },
];

const SORT_OPTIONS = [
  { value: "price", label: "가격 낮은순" },
  { value: "price-desc", label: "가격 높은순" },
  { value: "name", label: "이름순" },
  { value: "mallCount", label: "인기순" },
];

function sortParts(parts, sortBy) {
  return [...parts].sort((a, b) => {
    if (sortBy === "price") return (Number(a.price) || 0) - (Number(b.price) || 0);
    if (sortBy === "price-desc") return (Number(b.price) || 0) - (Number(a.price) || 0);
    if (sortBy === "mallCount") return (Number(b.mallCount) || 0) - (Number(a.mallCount) || 0);
    return String(a.name).localeCompare(String(b.name));
  });
}

export default function PCBuilder() {
  const [build, setBuild] = useState({});
  const [modal, setModal] = useState(null); // { category, label }
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

  const handleShare = async () => {
    const lines = SLOTS.map(({ key, label }) => {
      const p = build[key];
      return p ? `${label}: ${p.name} (${Number(p.price).toLocaleString()}원)` : null;
    }).filter(Boolean);
    if (!lines.length) return;
    const text = `[GoodPricePC 견적]\n${lines.join("\n")}\n총합: ${totalPrice.toLocaleString()}원`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert(text);
    }
  };

  const rawParts = modal ? (partsCache[modal.key] || []) : [];
  const filtered = rawParts.filter((p) =>
    String(p.name || "").toLowerCase().includes(search.toLowerCase())
  );
  const sorted = sortParts(filtered, sortBy);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">🛠️ 직접 견적 짜기</h1>
        <p className="text-slate-400">원하는 부품을 직접 선택해 나만의 PC 견적을 구성하세요.</p>
      </div>

      {/* Build slots */}
      <div className="border border-slate-700/50 rounded-2xl bg-slate-800/20 backdrop-blur-sm overflow-hidden divide-y divide-slate-700/30 mb-4">
        {SLOTS.map(({ key, label, icon }) => {
          const part = build[key];
          return (
            <div
              key={key}
              onClick={() => openModal({ key, label })}
              className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-slate-700/30 transition-colors group"
            >
              <span className="text-2xl w-8 text-center flex-shrink-0">{icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-slate-500 mb-0.5">{label}</div>
                {part ? (
                  <div className="flex items-center gap-2 min-w-0">
                    {part.image && (
                      <img src={part.image} alt="" className="w-8 h-8 object-contain rounded flex-shrink-0" />
                    )}
                    <span className="text-sm text-white truncate">{part.name}</span>
                  </div>
                ) : (
                  <span className="text-sm text-slate-500 group-hover:text-slate-400 transition-colors">
                    클릭하여 선택
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {part && (
                  <>
                    <span className="text-sm font-semibold text-white">
                      {Number(part.price).toLocaleString()}원
                    </span>
                    <button
                      onClick={(e) => removePart(key, e)}
                      className="text-slate-500 hover:text-red-400 transition-colors text-lg leading-none"
                      title="제거"
                    >
                      ×
                    </button>
                  </>
                )}
                {!part && (
                  <svg className="w-5 h-5 text-slate-600 group-hover:text-slate-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Total bar */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl px-5 py-4 flex items-center justify-between mb-4">
        <div>
          <span className="text-slate-400 text-sm">총 견적</span>
          {partCount > 0 && (
            <span className="ml-2 text-xs text-slate-500">({partCount}/8 부품)</span>
          )}
        </div>
        <span className="text-2xl font-bold text-white">{totalPrice.toLocaleString()}원</span>
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
          className="px-4 py-2.5 text-sm font-medium rounded-xl border border-slate-600 text-slate-400 hover:text-white hover:border-slate-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full sm:max-w-2xl bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-700 shadow-2xl flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="px-5 py-4 border-b border-slate-700 flex items-center gap-3 flex-shrink-0">
              <h2 className="text-lg font-bold text-white flex-1">{modal.label} 선택</h2>
              <button
                onClick={() => setModal(null)}
                className="text-slate-400 hover:text-white transition-colors text-2xl leading-none"
              >
                ×
              </button>
            </div>

            {/* Search + sort */}
            <div className="px-4 py-3 border-b border-slate-700 flex gap-2 flex-shrink-0">
              <input
                ref={searchRef}
                type="text"
                placeholder="제품명 검색"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 px-3 py-2 text-sm rounded-lg bg-slate-800 border border-slate-600 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-2 py-2 text-sm rounded-lg bg-slate-800 border border-slate-600 text-slate-200 focus:outline-none"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {/* Parts list */}
            <div className="overflow-y-auto flex-1">
              {loadingCat === modal.key ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : sorted.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-sm">
                  {search ? "검색 결과가 없습니다." : "부품을 불러오는 중..."}
                </div>
              ) : (
                <div className="divide-y divide-slate-700/30">
                  {sorted.slice(0, 100).map((part, i) => (
                    <button
                      key={part._id || part.name || i}
                      onClick={() => selectPart(part)}
                      className={`w-full flex items-center gap-4 px-5 py-3.5 text-left hover:bg-slate-700/40 transition-colors ${
                        build[modal.key]?.name === part.name ? "bg-purple-900/20 border-l-2 border-purple-500" : ""
                      }`}
                    >
                      {part.image && (
                        <img src={part.image} alt="" className="w-10 h-10 object-contain rounded flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white truncate">{part.name}</div>
                        {part.specSummary && (
                          <div className="text-xs text-slate-500 truncate mt-0.5">{part.specSummary}</div>
                        )}
                      </div>
                      <div className="text-sm font-semibold text-white flex-shrink-0">
                        {part.price > 0 ? `${Number(part.price).toLocaleString()}원` : "가격 미정"}
                      </div>
                    </button>
                  ))}
                  {sorted.length > 100 && (
                    <div className="px-5 py-3 text-xs text-slate-500 text-center">
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
