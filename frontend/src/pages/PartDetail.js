import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchPartDetail, fetchPriceHistory, fetchTrend, fetchMultiMallPrices, createAlert, fetchGptInfo, fetchDanawaUrl } from "../utils/api";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { SkeletonDetail } from "../components/SkeletonCard";

const PERIODS = [
  { label: "30일", days: 30 },
  { label: "60일", days: 60 },
  { label: "90일", days: 90 },
];

function filterByDays(history, days) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return (history || [])
    .filter((e) => e.price > 0 && new Date(e.date) >= cutoff)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

export default function PartDetail() {
  const { category, slug } = useParams();
  const [part, setPart] = useState(null);
  const [priceHistory, setPriceHistory] = useState([]);
  const [trend, setTrend] = useState(null);
  const [mallPrices, setMallPrices] = useState(null);
  const [period, setPeriod] = useState(90);
  const [loading, setLoading] = useState(true);

  // 가격 알림
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertEmail, setAlertEmail] = useState("");
  const [alertPrice, setAlertPrice] = useState("");
  const [alertSaving, setAlertSaving] = useState(false);
  const [alertDone, setAlertDone] = useState(false);

  // GPT 한줄평 on-demand
  const [gptLoading, setGptLoading] = useState(false);
  const [gptReview, setGptReview] = useState(null);
  const [gptSpecSummary, setGptSpecSummary] = useState(null);

  // 다나와 링크
  const [danawaLoading, setDanawaLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [detail, history, trendData, prices] = await Promise.allSettled([
          fetchPartDetail(category, slug),
          fetchPriceHistory(category, slug),
          fetchTrend(category, slug),
          fetchMultiMallPrices(category, decodeURIComponent(slug)),
        ]);
        setPart(detail.value ?? null);
        setPriceHistory(history.value || []);
        setTrend(trendData.value ?? null);
        setMallPrices(prices.value ?? null);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [category, slug]);

  useEffect(() => {
    if (part?.name) document.title = `GoodPricePC | ${part.name}`;
  }, [part]);

  const handleCreateAlert = async () => {
    if (!alertEmail || !alertPrice) { alert("이메일과 목표 가격을 입력하세요."); return; }
    setAlertSaving(true);
    try {
      await createAlert({ category, name: part.name, targetPrice: Number(alertPrice), email: alertEmail });
      setAlertDone(true);
      setAlertOpen(false);
    } catch (e) {
      alert(`알림 등록 실패: ${e.message}`);
    } finally {
      setAlertSaving(false);
    }
  };

  const handleGptInfo = async () => {
    setGptLoading(true);
    try {
      const data = await fetchGptInfo(part.name);
      setGptReview(data?.review || "AI 한줄평을 가져올 수 없습니다.");
      if (data?.specSummary) setGptSpecSummary(data.specSummary);
    } catch {
      setGptReview("AI 한줄평 생성에 실패했습니다.");
    } finally {
      setGptLoading(false);
    }
  };

  const handleDanawaOpen = async () => {
    setDanawaLoading(true);
    try {
      const data = await fetchDanawaUrl(part.name);
      if (data?.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      } else {
        alert("다나와 링크를 찾을 수 없습니다.");
      }
    } catch {
      alert("다나와 링크를 가져오는 데 실패했습니다.");
    } finally {
      setDanawaLoading(false);
    }
  };

  if (loading) return <SkeletonDetail />;
  if (!part) return <div className="text-center text-red-400 p-8 text-lg font-semibold">부품 정보를 불러올 수 없습니다.</div>;

  const n = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString() : "정보 없음");

  const filteredHistory = filterByDays(priceHistory, period);
  const chartPrices = filteredHistory.map((e) => e.price);
  const chartMin = chartPrices.length ? Math.min(...chartPrices) : null;
  const chartMax = chartPrices.length ? Math.max(...chartPrices) : null;
  const chartChange =
    chartPrices.length >= 2 && chartPrices[0] > 0
      ? Math.round(((chartPrices.at(-1) - chartPrices[0]) / chartPrices[0]) * 1000) / 10
      : null;

  // trend 카드: 항상 30/60/90 표시 (API에 없으면 null로 채움)
  const trendByDays = Object.fromEntries((trend?.trends || []).map((t) => [t.days, t]));
  const trendCards = [30, 60, 90].map((days) => ({ days, data: trendByDays[days] || null }));

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-4xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-start gap-5 mb-6">
        <div className="w-24 h-24 rounded-xl bg-slate-800/50 border border-slate-600 flex items-center justify-center overflow-hidden backdrop-blur-sm flex-shrink-0">
          {part.image ? (
            <img src={part.image} alt={part.name} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
          ) : (
            <span className="text-xs text-slate-400">NO IMAGE</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-bold text-white mb-3 truncate">{part.name}</h1>
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            {category === "gpu" && (
              <span className="px-3 py-1.5 rounded-lg border border-slate-600 bg-slate-800/50 text-slate-200 backdrop-blur-sm font-medium">3DMark {n(part?.benchmarkScore?.["3dmarkscore"])}</span>
            )}
            {category === "cpu" && (
              <span className="px-3 py-1.5 rounded-lg border border-slate-600 bg-slate-800/50 text-slate-200 backdrop-blur-sm font-medium">
                PassMark {n(part?.benchScore || part?.benchmarkScore?.passmarkscore)}
              </span>
            )}
          </div>
          {/* 가격 알림 + 다나와 버튼 */}
          <div className="mt-3 flex flex-wrap gap-2 items-center">
            {alertDone ? (
              <span className="text-xs text-green-400 font-medium">✅ 가격 알림이 등록되었습니다</span>
            ) : (
              <button
                onClick={() => setAlertOpen((v) => !v)}
                className="text-xs text-blue-400 hover:text-blue-300 border border-blue-700/50 hover:border-blue-500/70 px-3 py-1.5 rounded-lg transition-colors"
              >
                🔔 가격 알림 등록
              </button>
            )}
            <button
              onClick={handleDanawaOpen}
              disabled={danawaLoading}
              className="text-xs text-orange-400 hover:text-orange-300 border border-orange-700/50 hover:border-orange-500/70 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors"
            >
              {danawaLoading ? "로딩 중..." : "🔗 다나와에서 보기"}
            </button>
          </div>
          {alertOpen && (
            <div className="mt-3 p-4 bg-slate-800/60 border border-slate-600 rounded-xl space-y-3 max-w-sm">
              <p className="text-sm font-semibold text-white">목표 가격 도달 시 이메일 알림</p>
              <input
                type="email"
                placeholder="이메일 주소"
                value={alertEmail}
                onChange={(e) => setAlertEmail(e.target.value)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-500 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="number"
                placeholder={`목표 가격 (현재 ${Number(part.price).toLocaleString()}원)`}
                value={alertPrice}
                onChange={(e) => setAlertPrice(e.target.value)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-500 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleCreateAlert}
                  disabled={alertSaving}
                  className="text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white px-4 py-2 rounded-lg transition-colors"
                >
                  {alertSaving ? "등록 중..." : "등록"}
                </button>
                <button
                  onClick={() => setAlertOpen(false)}
                  className="text-sm bg-slate-600 hover:bg-slate-500 text-white px-4 py-2 rounded-lg transition-colors"
                >
                  취소
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-2xl font-bold text-white mb-1">
            {Number.isFinite(Number(part.price)) ? `${Number(part.price).toLocaleString()}원` : "가격 정보 없음"}
          </div>
          {priceHistory?.length > 1 && <div className="text-sm text-slate-400 mt-1">최근 {priceHistory.length}개 시점 데이터</div>}
        </div>
      </div>

      {(gptSpecSummary || part.specSummary || part.info) && (
        <div className="mt-6">
          <h3 className="text-lg font-bold text-white mb-3">주요 사양</h3>
          <div className="border border-slate-600 rounded-xl p-5 bg-slate-800/30 backdrop-blur-sm">
            <p className="text-base text-slate-200 leading-relaxed font-medium">
              {(gptSpecSummary || part.specSummary || part.info)
                .split("/")
                .map((seg, i) => (
                  <span key={i} className="inline-block">
                    {i > 0 && <span className="text-slate-500 mx-1">/</span>}
                    {seg.trim()}
                  </span>
                ))}
            </p>
          </div>
        </div>
      )}

      {/* 가격 변동 추이 (기간 탭 포함) */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-white">가격 변동 추이</h3>
          <div className="flex gap-1">
            {PERIODS.map(({ label, days }) => (
              <button
                key={days}
                onClick={() => setPeriod(days)}
                className={`px-3 py-1 text-xs rounded-lg border transition-colors ${
                  period === days
                    ? "bg-white text-slate-900 border-white"
                    : "bg-transparent text-slate-400 border-slate-600 hover:border-slate-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {filteredHistory.length > 0 && chartMin !== null && (
          <div className="flex gap-2 mb-3 text-xs">
            <span className="px-2 py-1 rounded-lg border border-slate-700 bg-slate-800/50 text-slate-400">
              최저 <span className="font-semibold text-green-400">{chartMin.toLocaleString()}원</span>
            </span>
            <span className="px-2 py-1 rounded-lg border border-slate-700 bg-slate-800/50 text-slate-400">
              최고 <span className="font-semibold text-red-400">{chartMax.toLocaleString()}원</span>
            </span>
            {chartChange !== null && (
              <span className={`px-2 py-1 rounded-lg border bg-slate-800/50 font-semibold ${
                chartChange > 0 ? "border-rose-700 text-rose-400" : chartChange < 0 ? "border-emerald-700 text-emerald-400" : "border-slate-700 text-slate-400"
              }`}>
                {chartChange > 0 ? "▲" : chartChange < 0 ? "▼" : "─"} {Math.abs(chartChange)}%
              </span>
            )}
          </div>
        )}

        <div className="border border-slate-600 rounded-xl bg-slate-800/30 backdrop-blur-sm p-4">
          {filteredHistory.length > 0 ? (
            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer>
                <LineChart data={filteredHistory}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                  <XAxis dataKey="date" stroke="#cbd5e1" tick={{ fill: "#cbd5e1", fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `${Number(v).toLocaleString()}원`} stroke="#cbd5e1" tick={{ fill: "#cbd5e1", fontSize: 11 }} width={90} />
                  <Tooltip
                    formatter={(v) => `${Number(v).toLocaleString()}원`}
                    contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #475569", borderRadius: "8px", color: "#e2e8f0" }}
                  />
                  <Line type="monotone" dataKey="price" stroke="#60a5fa" strokeWidth={3} dot={{ fill: "#60a5fa", r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-slate-400 text-base p-4 text-center">최근 {period}일 가격 데이터 없음</div>
          )}
        </div>
      </div>

      {/* 가격 추세 분석 (30/60/90일 항상 표시) */}
      <div className="mt-8">
        <h3 className="text-lg font-bold text-white mb-3">가격 추세 분석</h3>
        <div className="grid grid-cols-3 gap-3">
          {trendCards.map(({ days, data: t }) => (
            <div key={days} className="border border-slate-600 rounded-xl p-4 bg-slate-800/30 backdrop-blur-sm">
              <div className="text-xs text-slate-400 mb-2 font-medium">{days}일 기준</div>
              {t ? (
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">최저</span>
                    <span className="text-green-400 font-medium">{Number(t.min).toLocaleString()}원</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">최고</span>
                    <span className="text-red-400 font-medium">{Number(t.max).toLocaleString()}원</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">평균</span>
                    <span className="text-slate-200 font-medium">{Number(t.avg).toLocaleString()}원</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-700 pt-1.5">
                    <span className="text-slate-400">변동률</span>
                    <span className={`font-bold ${t.change > 0 ? "text-red-400" : t.change < 0 ? "text-green-400" : "text-slate-400"}`}>
                      {t.change > 0 ? "▲" : t.change < 0 ? "▼" : "─"} {Math.abs(t.change)}%
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-slate-500 text-xs text-center py-4">데이터 없음</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 멀티몰 가격 비교 */}
      {mallPrices?.naverMalls?.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-bold text-white mb-3">
            멀티몰 가격 비교
            <span className="text-sm text-slate-400 font-normal ml-2">네이버 쇼핑 기준</span>
          </h3>
          <div className="border border-slate-600 rounded-xl bg-slate-800/30 backdrop-blur-sm overflow-hidden">
            {mallPrices.lowestPrice && (
              <div className="px-5 py-3 bg-blue-900/30 border-b border-slate-600 flex items-center justify-between">
                <span className="text-sm text-blue-300">최저가 ({mallPrices.lowestMall})</span>
                <span className="text-lg font-bold text-blue-300">{Number(mallPrices.lowestPrice).toLocaleString()}원</span>
              </div>
            )}
            <div className="divide-y divide-slate-700/50">
              {mallPrices.naverMalls.slice(0, 5).map((mall, i) => (
                <div key={i} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm text-slate-300">{mall.mallName || "쇼핑몰"}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-white">{Number(mall.price).toLocaleString()}원</span>
                    {mall.link && (
                      <a href={mall.link} target="_blank" rel="noreferrer noopener"
                        className="text-xs text-blue-400 hover:text-blue-300 border border-blue-700/50 px-2 py-1 rounded">
                        구매
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-2 border-t border-slate-700/50">
              <span className="text-xs text-slate-500">
                총 {mallPrices.mallCount}개 쇼핑몰 • {new Date(mallPrices.checkedAt).toLocaleString("ko-KR")}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* AI 한줄평 */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-white">AI 한줄평</h3>
          {!part.review && !gptReview && (
            <button
              onClick={handleGptInfo}
              disabled={gptLoading}
              className="text-xs bg-purple-700 hover:bg-purple-600 disabled:bg-slate-700 text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              {gptLoading ? "생성 중..." : "✨ AI 한줄평 생성"}
            </button>
          )}
        </div>
        {(part.review || gptReview) && (
          <div className="border border-slate-600 rounded-xl p-5 bg-slate-800/30 backdrop-blur-sm text-base text-slate-200 leading-relaxed font-medium">
            {gptReview || part.review}
          </div>
        )}
        {!part.review && !gptReview && !gptLoading && (
          <p className="text-sm text-slate-500">아직 AI 한줄평이 없습니다. 위 버튼을 눌러 생성하세요.</p>
        )}
      </div>
    </div>
  );
}
