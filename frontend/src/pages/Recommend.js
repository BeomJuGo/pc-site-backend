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

const PURPOSE_INFO = {
  gaming: {
    icon: "🎮",
    label: "게이밍용",
    cpuPct: 30,
    gpuPct: 50,
    secPct: 20,
    desc: "FPS·RPG 등 고사양 게임에 최적화. 예산이 충분하면 X3D(3D V-Cache) CPU를 우선 선택해 프레임 방어 성능을 극대화하고, 나머지를 GPU·메모리에 배분합니다.",
    activeClass: "border-indigo-500 bg-indigo-50",
    badgeClass: "bg-indigo-100 text-indigo-700",
  },
  work: {
    icon: "🖥",
    label: "작업용",
    cpuPct: 45,
    gpuPct: 35,
    secPct: 20,
    desc: "영상편집·3D 렌더링·AI·인코딩 등 멀티코어 작업에 최적화. X3D 시리즈 대신 코어 수가 많은 멀티코어 CPU를 우선 선택하며, GPU는 가속용으로 35% 이내로 제한합니다.",
    activeClass: "border-orange-500 bg-orange-50",
    badgeClass: "bg-orange-100 text-orange-700",
  },
};

const MAX_POLL = 6;
const POLL_INTERVAL = 10000;

export default function Recommend() {
  const [budget, setBudget] = useState(1000000);
  const [purpose, setPurpose] = useState("gaming");
  const [cpuBrand, setCpuBrand] = useState("amd");
  const [gpuBrand, setGpuBrand] = useState("nvidia");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pollCount, setPollCount] = useState(0);
  const [waitMsg, setWaitMsg] = useState("");
  const pollRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "AI PC 견적 추천 | 가성비PC";
  }, []);

  useEffect(() => () => clearTimeout(pollRef.current), []);

  const fetchV2 = async (sel, attempt = 0) => {
    const { budget: b, purpose: p, cpuBrand: cb, gpuBrand: gb } = sel;
    try {
      const res = await fetch(
        `/api/recommend/budget-set-v2?budget=${b}&cpuBrand=${cb}&gpuBrand=${gb}&purpose=${p}`
      );
      if (res.ok) {
        const data = await res.json();
        setResults({ parts: data.parts || {}, totalPrice: data.totalPrice || 0, summary: data.summary, reasoning: data.reasoning });
        setLoading(false);
        setPollCount(0);
        setWaitMsg("");
        return;
      }
      if (res.status === 503) {
        const next = attempt + 1;
        if (next > MAX_POLL) {
          setError("견적 준비에 시간이 걸리고 있습니다. 잠시 후 다시 시도해주세요.");
          setLoading(false); setPollCount(0); setWaitMsg("");
          return;
        }
        setPollCount(next);
        setWaitMsg(`AI가 견적을 생성 중입니다... (${next}/${MAX_POLL})`);
        pollRef.current = setTimeout(() => fetchV2(sel, next), POLL_INTERVAL);
        return;
      }
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `서버 오류 (${res.status})`);
    } catch (e) {
      if (e.name === "AbortError") return;
      setError(e.message || "추천 요청에 실패했습니다.");
      setLoading(false); setPollCount(0); setWaitMsg("");
    }
  };

  const handleRecommend = () => {
    clearTimeout(pollRef.current);
    setLoading(true);
    setError(null);
    setResults(null);
    setPollCount(0);
    setWaitMsg("AI 견적을 불러오는 중...");
    fetchV2({ budget, purpose, cpuBrand, gpuBrand }, 0);
  };

  const info = PURPOSE_INFO[purpose];

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">✨ AI PC 견적 추천</h1>
        <p className="text-gray-500">사용 목적과 예산을 선택하면 AI가 최적의 부품 조합을 추천합니다.</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-6 shadow-sm">

        {/* 사용 목적 선택 */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-3">사용 목적</label>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(PURPOSE_INFO).map(([key, pi]) => (
              <button
                key={key}
                onClick={() => setPurpose(key)}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  purpose === key ? pi.activeClass : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div className="font-bold text-gray-900 mb-2 text-sm">
                  {pi.icon} {pi.label}
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${pi.badgeClass}`}>
                    GPU {pi.gpuPct}%
                  </span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${pi.badgeClass}`}>
                    CPU {pi.cpuPct}%
                  </span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                    보조부품 {pi.secPct}%
                  </span>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">{pi.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* 예산 선택 */}
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

        {/* 브랜드 선택 */}
        <div className="mb-5 grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">CPU 브랜드</label>
            <div className="flex gap-2">
              {[["amd", "AMD"], ["intel", "Intel"]].map(([val, lbl]) => (
                <button
                  key={val}
                  onClick={() => setCpuBrand(val)}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-all ${
                    cpuBrand === val
                      ? val === "amd"
                        ? "bg-red-500 text-white border-transparent shadow-sm"
                        : "bg-blue-500 text-white border-transparent shadow-sm"
                      : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              GPU 브랜드
              {purpose === "work" && (
                <span className="ml-2 text-xs font-normal text-amber-600">(작업용은 NVIDIA 권장)</span>
              )}
            </label>
            <div className="flex gap-2">
              {[["nvidia", "NVIDIA"], ["amd", "AMD"]].map(([val, lbl]) => (
                <button
                  key={val}
                  onClick={() => setGpuBrand(val)}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-all ${
                    gpuBrand === val
                      ? val === "nvidia"
                        ? "bg-green-600 text-white border-transparent shadow-sm"
                        : "bg-red-500 text-white border-transparent shadow-sm"
                      : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
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
            `${info.icon} ${(budget / 10000).toFixed(0)}만원 ${info.label} 견적 추천받기`
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
            <div className="px-5 py-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-700 text-sm font-medium">
              💡 {results.summary}
            </div>
          )}

          {results.reasoning && (
            <div className="px-5 py-4 bg-gradient-to-br from-violet-50 to-blue-50 border border-violet-200 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">🤖</span>
                <span className="text-sm font-semibold text-violet-900">AI 추천 이유</span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{results.reasoning}</p>
            </div>
          )}

          {purpose === "work" && gpuBrand === "amd" && (
            <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs leading-relaxed">
              ⚠️ <span className="font-semibold">참고:</span> 영상편집 가속(NVENC), AI/ML(CUDA), 3D 렌더링은 NVIDIA가 더 강력합니다. 작업용으로 GPU 가속이 중요하다면 NVIDIA 선택을 고려해주세요.
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
            {Object.entries(PART_LABELS).map(([key, label]) => {
              const part = results.parts[key];
              if (!part) return null;
              return (
                <div key={key} className="border-b border-gray-100 last:border-b-0">
                  <div className="px-4 pt-3 pb-1 flex items-center gap-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${PART_COLORS[key]}`}>
                      {label}
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
                {(results.totalPrice || 0).toLocaleString()}원
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
