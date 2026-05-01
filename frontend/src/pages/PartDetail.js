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

  const [alertOpen, setAlertOpen] = useState(false);
  const [alertEmail, setAlertEmail] = useState("");
  const [alertPrice, setAlertPrice] = useState("");
  const [alertSaving, setAlertSaving] = useState(false);
  const [alertDone, setAlertDone] = useState(false);

  const [gptLoading, setGptLoading] = useState(false);
  const [gptReview, setGptReview] = useState(null);
  const [gptSpecSummary, setGptSpecSummary] = useState(null);

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
    if (part?.name) document.title = `가성비PC | ${part.name}`;
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
  if (!part) return <div className="text-center text-red-500 p-8 text-lg font-semibold">부품 정보를 불러올 수 없습니다.</div>;

  const n = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString() : "정보 없음");

  const filteredHistory = filterByDays(priceHistory, period);
  const chartPrices = filteredHistory.map((e) => e.price);
  const chartMin = chartPrices.length ? Math.min(...chartPrices) : null;
  const chartMax = chartPrices.length ? Math.max(...chartPrices) : null;
  const chartChange =
    chartPrices.length >= 2 && chartPrices[0] > 0
      ? Math.round(((chartPrices.at(-1) - chartPrices[0]) / chartPrices[0]) * 1000) / 10
      : null;

  const trendByDays = Object.fromEntries((trend?.trends || []).map((t) => [t.days, t]));
  const trendCards = [30, 60, 90].map((days) => ({ days, data: trendByDays[days] || null }));

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-4xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-start gap-5 mb-6">
        <div className="w-24 h-24 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0">
          {part.image ? (
            <img src={part.image} alt={part.name} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
          ) : (
            <span className="text-xs text-gray-400">NO IMAGE</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-bold text-gray-900 mb-3 truncate">{part.name}</h1>
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            {category === "gpu" && (
              <span className="px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-100 text-gray-700 font-medium">3DMark {n(part?.benchmarkScore?.["3dmarkscore"])}</span>
            )}
            {category === "cpu" && (
              <span className="px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-100 text-gray-700 font-medium">
                PassMark {n(part?.benchScore || part?.benchmarkScore?.passmarkscore)}
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 items-center">
            {alertDone ? (
              <span className="text-xs text-green-600 font-medium">✅ 가격 알림이 등록되었습니다</span>
            ) : (
              <button
                onClick={() => setAlertOpen((v) => !v)}
                className="text-xs text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-300 px-3 py-1.5 rounded-lg transition-colors"
              >
                🔔 가격 알림 등록
              </button>
            )}
            <button
              onClick={handleDanawaOpen}
              disabled={danawaLoading}
              className="text-xs text-orange-600 hover:text-orange-700 border border-orange-200 hover:border-orange-300 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors"
            >
              {danawaLoading ? "로딩 중..." : "🔗 다나와에서 보기"}
            </button>
          </div>
          {alertOpen && (
            <div className="mt-3 p-4 bg-white border border-gray-200 rounded-xl shadow-sm space-y-3 max-w-sm">
              <p className="text-sm font-semibold text-gray-900">목표 가격 도달 시 이메일 알림</p>
              <input
                type="email"
                placeholder="이메일 주소"
                value={alertEmail}
                onChange={(e) => setAlertEmail(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="number"
                placeholder={`목표 가격 (현재 ${Number(part.price).toLocaleString()}원)`}
                value={alertPrice}
                onChange={(e) => setAlertPrice(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleCreateAlert}
                  disabled={alertSaving}
                  className="text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg transition-colors"
                >
                  {alertSaving ? "등록 중..." : "등록"}
                </button>
                <button
                  onClick={() => setAlertOpen(false)}
                  className="text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-lg transition-colors"
                >
                  취소
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-2xl font-bold text-gray-900 mb-1">
            {Number.isFinite(Number(part.price)) ? `${Number(part.price).toLocaleString()}원` : "가격 정보 없음"}
          </div>
          {priceHistory?.length > 1 && <div className="text-sm text-gray-500 mt-1">최근 {priceHistory.length}개 시점 데이터</div>}
        </div>
      </div>

      {(gptSpecSummary || part.specSummary || part.info) && (
        <div className="mt-6">
          <h3 className="text-lg font-bold text-gray-900 mb-3">주요 사양</h3>
          <div className="border border-gray-200 rounded-xl p-5 bg-white shadow-sm">
            <p className="text-base text-gray-700 leading-relaxed font-medium">
              {(gptSpecSummary || part.specSummary || part.info)
                .split("/")
                .map((seg, i) => (
                  <span key={i} className="inline-block">
                    {i > 0 && <span className="text-gray-300 mx-1">/</span>}
                    {seg.trim()}
                  </span>
                ))}
            </p>
          </div>
        </div>
      )}

      {/* 가격 변동 추이 */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-gray-900">가격 변동 추이</h3>
          <div className="flex gap-1">
            {PERIODS.map(({ label, days }) => (
              <button
                key={days}
                onClick={() => setPeriod(days)}
                className={`px-3 py-1 text-xs rounded-lg border transition-colors ${
                  period === days
                    ? "bg-gray-900 text-white border-gray-900"
                    : "bg-transparent text-gray-500 border-gray-300 hover:border-gray-500"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {filteredHistory.length > 0 && chartMin !== null && (
          <div className="flex gap-2 mb-3 text-xs">
            <span className="px-2 py-1 rounded-lg border border-gray-200 bg-white text-gray-500">
              최저 <span className="font-semibold text-green-600">{chartMin.toLocaleString()}원</span>
            </span>
            <span className="px-2 py-1 rounded-lg border border-gray-200 bg-white text-gray-500">
              최고 <span className="font-semibold text-red-600">{chartMax.toLocaleString()}원</span>
            </span>
            {chartChange !== null && (
              <span className={`px-2 py-1 rounded-lg border bg-white font-semibold ${
                chartChange > 0 ? "border-rose-200 text-rose-600" : chartChange < 0 ? "border-emerald-200 text-emerald-600" : "border-gray-200 text-gray-500"
              }`}>
                {chartChange > 0 ? "▲" : chartChange < 0 ? "▼" : "─"} {Math.abs(chartChange)}%
              </span>
            )}
          </div>
        )}

        <div className="border border-gray-200 rounded-xl bg-white p-4 shadow-sm">
          {filteredHistory.length > 0 ? (
            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer>
                <LineChart data={filteredHistory}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" stroke="#9ca3af" tick={{ fill: "#6b7280", fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `${Number(v).toLocaleString()}원`} stroke="#9ca3af" tick={{ fill: "#6b7280", fontSize: 11 }} width={90} />
                  <Tooltip
                    formatter={(v) => `${Number(v).toLocaleString()}원`}
                    contentStyle={{ backgroundColor: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "8px", color: "#111827" }}
                  />
                  <Line type="monotone" dataKey="price" stroke="#2563eb" strokeWidth={3} dot={{ fill: "#2563eb", r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-gray-400 text-base p-4 text-center">최근 {period}일 가격 데이터 없음</div>
          )}
        </div>
      </div>

      {/* 가격 추세 분석 */}
      <div className="mt-8">
        <h3 className="text-lg font-bold text-gray-900 mb-3">가격 추세 분석</h3>
        <div className="grid grid-cols-3 gap-3">
          {trendCards.map(({ days, data: t }) => (
            <div key={days} className="border border-gray-200 rounded-xl p-4 bg-white shadow-sm">
              <div className="text-xs text-gray-500 mb-2 font-medium">{days}일 기준</div>
              {t ? (
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">최저</span>
                    <span className="text-green-600 font-medium">{Number(t.min).toLocaleString()}원</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">최고</span>
                    <span className="text-red-600 font-medium">{Number(t.max).toLocaleString()}원</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">평균</span>
                    <span className="text-gray-700 font-medium">{Number(t.avg).toLocaleString()}원</span>
                  </div>
                  <div className="flex justify-between border-t border-gray-100 pt-1.5">
                    <span className="text-gray-500">변동률</span>
                    <span className={`font-bold ${t.change > 0 ? "text-red-600" : t.change < 0 ? "text-green-600" : "text-gray-500"}`}>
                      {t.change > 0 ? "▲" : t.change < 0 ? "▼" : "─"} {Math.abs(t.change)}%
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-gray-400 text-xs text-center py-4">데이터 없음</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 멀티몰 가격 비교 */}
      {mallPrices?.naverMalls?.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-bold text-gray-900 mb-3">
            멀티몰 가격 비교
            <span className="text-sm text-gray-500 font-normal ml-2">네이버 쇼핑 기준</span>
          </h3>
          <div className="border border-gray-200 rounded-xl bg-white overflow-hidden shadow-sm">
            {mallPrices.lowestPrice && (
              <div className="px-5 py-3 bg-blue-50 border-b border-gray-200 flex items-center justify-between">
                <span className="text-sm text-blue-700">최저가 ({mallPrices.lowestMall})</span>
                <span className="text-lg font-bold text-blue-700">{Number(mallPrices.lowestPrice).toLocaleString()}원</span>
              </div>
            )}
            <div className="divide-y divide-gray-100">
              {mallPrices.naverMalls.slice(0, 5).map((mall, i) => (
                <div key={i} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm text-gray-700">{mall.mallName || "쇼핑몰"}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-900">{Number(mall.price).toLocaleString()}원</span>
                    {mall.link && (
                      <a href={mall.link} target="_blank" rel="noreferrer noopener"
                        className="text-xs text-blue-600 hover:text-blue-700 border border-blue-200 px-2 py-1 rounded">
                        구매
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-2 border-t border-gray-100 bg-gray-50">
              <span className="text-xs text-gray-400">
                총 {mallPrices.mallCount}개 쇼핑몰 • {new Date(mallPrices.checkedAt).toLocaleString("ko-KR")}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* AI 한줄평 */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-gray-900">AI 한줄평</h3>
          {!part.review && !gptReview && (
            <button
              onClick={handleGptInfo}
              disabled={gptLoading}
              className="text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              {gptLoading ? "생성 중..." : "✨ AI 한줄평 생성"}
            </button>
          )}
        </div>
        {(part.review || gptReview) && (
          <div className="border border-gray-200 rounded-xl p-5 bg-white shadow-sm text-base text-gray-700 leading-relaxed font-medium">
            {gptReview || part.review}
          </div>
        )}
        {!part.review && !gptReview && !gptLoading && (
          <p className="text-sm text-gray-400">아직 AI 한줄평이 없습니다. 위 버튼을 눌러 생성하세요.</p>
        )}
      </div>
    </div>
  );
}
