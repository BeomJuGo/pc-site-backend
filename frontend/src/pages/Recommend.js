import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import PartCard from "../components/PartCard";

const BUDGETS = Array.from({ length: 16 }, (_, i) => 500000 + i * 100000);

const PART_LABELS = {
  cpu: "CPU",
  gpu: "GPU",
  motherboard: "메인보드",
  memory: "메모리",
  storage: "저장장치",
  psu: "파워",
  cooler: "쿨러",
  case: "케이스",
};

const PART_COLORS = {
  cpu: "bg-blue-50 text-blue-700 border-blue-200",
  gpu: "bg-indigo-50 text-indigo-700 border-indigo-200",
  motherboard: "bg-orange-50 text-orange-700 border-orange-200",
  memory: "bg-green-50 text-green-700 border-green-200",
  storage: "bg-indigo-50 text-indigo-700 border-indigo-200",
  psu: "bg-yellow-50 text-yellow-700 border-yellow-200",
  cooler: "bg-cyan-50 text-cyan-700 border-cyan-200",
  case: "bg-gray-100 text-gray-600 border-gray-300",
};

const MAX_POLL = 6;
const POLL_INTERVAL = 10000;

function BrandToggle({ label, colorClass, hasA, hasB, labelA, labelB, active, onSelect, colorA, colorB }) {
  return (
    <div className="px-4 pt-3 pb-1 flex items-center gap-2 flex-wrap">
      <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${colorClass}`}>{label}</span>
      {hasA && hasB ? (
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => onSelect(labelA.toLowerCase())}
            className={`px-3 py-0.5 text-xs font-bold rounded-full border transition-all ${
              active === labelA.toLowerCase()
                ? `${colorA} shadow-sm`
                : "bg-white text-gray-500 border-gray-300 hover:border-gray-400"
            }`}
          >
            {labelA}
          </button>
          <button
            onClick={() => onSelect(labelB.toLowerCase())}
            className={`px-3 py-0.5 text-xs font-bold rounded-full border transition-all ${
              active === labelB.toLowerCase()
                ? `${colorB} shadow-sm`
                : "bg-white text-gray-500 border-gray-300 hover:border-gray-400"
            }`}
          >
            {labelB}
          </button>
        </div>
      ) : (
        <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${hasA ? colorA : colorB}`}>
          {hasA ? labelA : labelB}
        </span>
      )}
    </div>
  );
}

export default function Recommend() {
  const [budget, setBudget] = useState(1000000);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pollCount, setPollCount] = useState(0);
  const [waitMsg, setWaitMsg] = useState("");
  const [cpuBrand, setCpuBrand] = useState("amd");
  const [gpuBrand, setGpuBrand] = useState("nvidia");
  const pollRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "AI PC 견적 추천 | 가성비PC";
  }, []);

  useEffect(() => () => clearTimeout(pollRef.current), []);

  // 결과가 바뀌면 기본 브랜드를 사용 가능한 것으로 초기화
  useEffect(() => {
    if (!results) return;
    if (cpuBrand === "amd" && !results.parts.cpuAmd && results.parts.cpuIntel) setCpuBrand("intel");
    if (cpuBrand === "intel" && !results.parts.cpuIntel && results.parts.cpuAmd) setCpuBrand("amd");
    if (gpuBrand === "amd" && !results.parts.gpuAmd && results.parts.gpuNvidia) setGpuBrand("nvidia");
    if (gpuBrand === "nvidia" && !results.parts.gpuNvidia && results.parts.gpuAmd) setGpuBrand("amd");
  }, [results]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchV2 = async (selectedBudget, attempt = 0) => {
    try {
      const res = await fetch(`/api/recommend/budget-set-v2?budget=${selectedBudget}`);
      if (res.ok) {
        const data = await res.json();
        const parts = {};
        for (const [key, part] of Object.entries(data.parts || {})) {
          if (part) parts[key] = { ...part, category: part.category || key };
        }
        setResults({ parts, basePrice: data.basePrice || 0, summary: data.summary });
        setLoading(false);
        setPollCount(0);
        setWaitMsg("");
        return;
      }
      if (res.status === 503) {
        const nextAttempt = attempt + 1;
        if (nextAttempt > MAX_POLL) {
          setError("견적 준비에 시간이 걸리고 있습니다. 잠시 후 다시 시도해주세요.");
          setLoading(false);
          setPollCount(0);
          setWaitMsg("");
          return;
        }
        setPollCount(nextAttempt);
        setWaitMsg(`AI가 견적을 생성 중입니다... (${nextAttempt}/${MAX_POLL})`);
        pollRef.current = setTimeout(() => fetchV2(selectedBudget, nextAttempt), POLL_INTERVAL);
        return;
      }
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `서버 오류 (${res.status})`);
    } catch (e) {
      if (e.name === "AbortError") return;
      setError(e.message || "추천 요청에 실패했습니다.");
      setLoading(false);
      setPollCount(0);
      setWaitMsg("");
    }
  };

  const handleRecommend = () => {
    clearTimeout(pollRef.current);
    setLoading(true);
    setError(null);
    setResults(null);
    setPollCount(0);
    setWaitMsg("AI 견적을 불러오는 중...");
    fetchV2(budget, 0);
  };

  // 선택된 CPU 플랫폼 (cpu + board + mem)
  const getSelectedCpuParts = (res) => {
    if (!res) return null;
    if (cpuBrand === "amd" && res.parts.cpuAmd)
      return { cpu: res.parts.cpuAmd, board: res.parts.boardAmd, mem: res.parts.memAmd };
    if (cpuBrand === "intel" && res.parts.cpuIntel)
      return { cpu: res.parts.cpuIntel, board: res.parts.boardIntel, mem: res.parts.memIntel };
    // fallback
    if (res.parts.cpuAmd)
      return { cpu: res.parts.cpuAmd, board: res.parts.boardAmd, mem: res.parts.memAmd };
    if (res.parts.cpuIntel)
      return { cpu: res.parts.cpuIntel, board: res.parts.boardIntel, mem: res.parts.memIntel };
    return null;
  };

  // 선택된 GPU
  const getSelectedGpu = (res) => {
    if (!res) return null;
    if (gpuBrand === "amd" && res.parts.gpuAmd) return res.parts.gpuAmd;
    if (gpuBrand === "nvidia" && res.parts.gpuNvidia) return res.parts.gpuNvidia;
    return res.parts.gpuNvidia || res.parts.gpuAmd || null;
  };

  // 선택 조합의 총합
  const getDisplayTotal = (res) => {
    if (!res) return 0;
    const cpuParts = getSelectedCpuParts(res);
    const gpu = getSelectedGpu(res);
    return (res.basePrice || 0)
      + (cpuParts?.cpu?.price || 0)
      + (cpuParts?.board?.price || 0)
      + (cpuParts?.mem?.price || 0)
      + (gpu?.price || 0);
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">✨ AI PC 견적 추천</h1>
        <p className="text-gray-500">예산을 선택하면 AI가 최고 가성비 부품 조합을 추천합니다.</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-6 shadow-sm">
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-3">예산 선택</label>
          <div className="flex flex-wrap gap-1.5">
            {BUDGETS.map((b) => (
              <button
                key={b}
                onClick={() => setBudget(b)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                  budget === b
                    ? "bg-blue-600 text-white border-transparent shadow-sm"
                    : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50 hover:border-gray-400"
                }`}
              >
                {(b / 10000).toFixed(0)}만
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-400">
            선택된 예산: <span className="text-gray-700 font-medium">{budget.toLocaleString()}원</span>
          </p>
          <div className="mt-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-xs leading-relaxed">
            💡 AI 견적 추천은 최대 <span className="font-semibold">200만원</span>까지 지원합니다.
            200만원 초과 고사양 PC는{" "}
            <button
              type="button"
              onClick={() => navigate("/pc-builder")}
              className="underline underline-offset-2 font-semibold hover:text-amber-900 transition-colors"
            >
              PC 견적 빌더
            </button>
            를 이용해 직접 구성해 주세요.
          </div>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleRecommend}
          disabled={loading}
          className="w-full py-3 font-semibold text-base rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {waitMsg || "불러오는 중..."}
            </span>
          ) : (
            `✨ ${(budget / 10000).toFixed(0)}만원 견적 추천받기`
          )}
        </button>

        {loading && pollCount > 0 && (
          <p className="mt-2 text-xs text-gray-400 text-center">
            첫 요청 시 AI 생성에 최대 1분이 소요될 수 있습니다
          </p>
        )}
      </div>

      {results && (
        <div className="space-y-3">
          {results.summary && (
            <div className="px-5 py-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-700 text-sm">
              💡 {results.summary}
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
            {Object.entries(PART_LABELS).map(([key]) => {
              const { parts } = results;

              /* ── CPU 섹션: AMD / Intel 토글 ── */
              if (key === "cpu") {
                const hasAmd   = !!parts.cpuAmd;
                const hasIntel = !!parts.cpuIntel;
                if (!hasAmd && !hasIntel) return null;

                const activeCpu = (cpuBrand === "amd" && hasAmd) || !hasIntel ? "amd" : "intel";
                const displayCpu = activeCpu === "amd" ? parts.cpuAmd : parts.cpuIntel;

                return (
                  <div key="cpu" className="border-b border-gray-100">
                    <BrandToggle
                      label="CPU"
                      colorClass={PART_COLORS.cpu}
                      hasA={hasAmd} hasB={hasIntel}
                      labelA="AMD" labelB="Intel"
                      active={activeCpu}
                      onSelect={setCpuBrand}
                      colorA="bg-red-500 text-white border-transparent"
                      colorB="bg-blue-500 text-white border-transparent"
                    />
                    {displayCpu && (
                      <PartCard
                        part={displayCpu}
                        onClick={() => navigate(`/detail/cpu/${encodeURIComponent(displayCpu.name)}`)}
                      />
                    )}
                  </div>
                );
              }

              /* ── GPU 섹션: AMD / NVIDIA 토글 ── */
              if (key === "gpu") {
                const hasAmd    = !!parts.gpuAmd;
                const hasNvidia = !!parts.gpuNvidia;
                if (!hasAmd && !hasNvidia) return null;

                const activeGpu = (gpuBrand === "amd" && hasAmd) || !hasNvidia ? "amd" : "nvidia";
                const displayGpu = activeGpu === "amd" ? parts.gpuAmd : parts.gpuNvidia;

                return (
                  <div key="gpu" className="border-b border-gray-100">
                    <BrandToggle
                      label="GPU"
                      colorClass={PART_COLORS.gpu}
                      hasA={hasAmd} hasB={hasNvidia}
                      labelA="AMD" labelB="NVIDIA"
                      active={activeGpu}
                      onSelect={setGpuBrand}
                      colorA="bg-red-500 text-white border-transparent"
                      colorB="bg-green-600 text-white border-transparent"
                    />
                    {displayGpu && (
                      <PartCard
                        part={displayGpu}
                        onClick={() => navigate(`/detail/gpu/${encodeURIComponent(displayGpu.name)}`)}
                      />
                    )}
                  </div>
                );
              }

              /* ── 메인보드: 선택된 CPU 브랜드에 맞는 것 표시 ── */
              if (key === "motherboard") {
                const activeCpu = (cpuBrand === "amd" && !!parts.cpuAmd) || !parts.cpuIntel ? "amd" : "intel";
                const board = activeCpu === "amd" ? parts.boardAmd : parts.boardIntel;
                if (!board) return null;
                return (
                  <div key="motherboard" className="border-b border-gray-100">
                    <div className="px-4 pt-3 pb-1 flex items-center gap-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${PART_COLORS.motherboard}`}>메인보드</span>
                    </div>
                    <PartCard
                      part={board}
                      onClick={() => navigate(`/detail/motherboard/${encodeURIComponent(board.name)}`)}
                    />
                  </div>
                );
              }

              /* ── 메모리: 선택된 CPU 브랜드에 맞는 것 표시 ── */
              if (key === "memory") {
                const activeCpu = (cpuBrand === "amd" && !!parts.cpuAmd) || !parts.cpuIntel ? "amd" : "intel";
                const mem = activeCpu === "amd" ? parts.memAmd : parts.memIntel;
                if (!mem) return null;
                return (
                  <div key="memory" className="border-b border-gray-100">
                    <div className="px-4 pt-3 pb-1 flex items-center gap-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${PART_COLORS.memory}`}>메모리</span>
                    </div>
                    <PartCard
                      part={mem}
                      onClick={() => navigate(`/detail/memory/${encodeURIComponent(mem.name)}`)}
                    />
                  </div>
                );
              }

              /* ── 보조 부품 (공통) ── */
              const part = parts[key];
              if (!part) return null;
              return (
                <div key={key} className="border-b border-gray-100 last:border-b-0">
                  <div className="px-4 pt-3 pb-1 flex items-center gap-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${PART_COLORS[key]}`}>
                      {PART_LABELS[key]}
                    </span>
                  </div>
                  <PartCard
                    part={part}
                    onClick={() => navigate(`/detail/${part.category || key}/${encodeURIComponent(part.name)}`)}
                  />
                </div>
              );
            })}

            <div className="px-5 py-4 bg-gray-50 flex items-center justify-between">
              <span className="text-gray-500 text-sm">총 견적</span>
              <span className="text-xl font-bold text-gray-900">
                {getDisplayTotal(results).toLocaleString()}원
              </span>
            </div>
          </div>

          <button
            onClick={() => { setResults(null); setError(null); }}
            className="w-full py-2 text-sm text-gray-500 hover:text-gray-900 border border-gray-200 rounded-xl hover:border-gray-400 transition-colors"
          >
            다시 추천받기
          </button>
        </div>
      )}
    </div>
  );
}
