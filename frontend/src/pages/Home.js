import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
  Cpu, Monitor, MemoryStick, CircuitBoard, HardDrive, Package, Wind, Zap,
  TrendingDown, Sparkles, Bot, ChevronRight, Database, RefreshCw, Search,
} from "lucide-react";

const CATEGORIES = [
  { title: "CPU", href: "/category/cpu", Icon: Cpu, color: "text-blue-600" },
  { title: "GPU", href: "/category/gpu", Icon: Monitor, color: "text-violet-600" },
  { title: "메모리", href: "/category/memory", Icon: MemoryStick, color: "text-green-600" },
  { title: "메인보드", href: "/category/motherboard", Icon: CircuitBoard, color: "text-orange-600" },
  { title: "저장장치", href: "/category/storage", Icon: HardDrive, color: "text-indigo-600" },
  { title: "케이스", href: "/category/case", Icon: Package, color: "text-gray-600" },
  { title: "쿨러", href: "/category/cooler", Icon: Wind, color: "text-cyan-600" },
  { title: "파워", href: "/category/psu", Icon: Zap, color: "text-yellow-600" },
];

const STATS = [
  { label: "800+ 부품 데이터", Icon: Database },
  { label: "매일 가격 업데이트", Icon: RefreshCw },
  { label: "AI 가성비 분석", Icon: Bot },
  { label: "무료 사용", Icon: Sparkles },
];

const FEATURES = [
  { title: "실시간 가격 비교", description: "다양한 쇼핑몰의 최신 가격을 실시간으로 비교합니다", Icon: TrendingDown },
  { title: "성능 데이터", description: "벤치마크 점수와 실제 성능 데이터를 제공합니다", Icon: Zap },
  { title: "AI 추천", description: "예산과 용도에 맞는 최적의 부품을 추천합니다", Icon: Bot },
];

const CAT_LABEL = { cpu: "CPU", gpu: "GPU", motherboard: "메인보드", memory: "메모리", storage: "저장장치", case: "케이스", cooler: "쿨러", psu: "파워" };
const CAT_COLOR = {
  cpu: "bg-blue-50 text-blue-700 border-blue-200",
  gpu: "bg-indigo-50 text-indigo-700 border-indigo-200",
  motherboard: "bg-orange-50 text-orange-700 border-orange-200",
  memory: "bg-green-50 text-green-700 border-green-200",
  storage: "bg-indigo-50 text-indigo-700 border-indigo-200",
  psu: "bg-yellow-50 text-yellow-700 border-yellow-200",
  cooler: "bg-cyan-50 text-cyan-700 border-cyan-200",
  case: "bg-gray-100 text-gray-600 border-gray-300",
};

function PriceDrops() {
  const [drops, setDrops] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/parts/price-drops?limit=10")
      .then((r) => r.json())
      .then((data) => { setDrops(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="w-7 h-7 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!drops.length) {
    return <div className="text-center py-8 text-gray-400 text-sm">최근 가격 하락 데이터가 없습니다.</div>;
  }

  return (
    <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
      {drops.map((item, i) => (
        <Link
          key={item._id || i}
          to={`/detail/${item.category}/${encodeURIComponent(item.name)}`}
          className="flex items-center gap-3 px-4 py-3.5 bg-white hover:bg-gray-50 transition-colors group"
        >
          <span className="text-gray-400 text-xs w-5 text-center flex-shrink-0">{i + 1}</span>
          {item.image && (
            <img src={item.image} alt="" className="w-9 h-9 object-contain rounded flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm text-gray-900 truncate group-hover:text-blue-600 transition-colors">{item.name}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`text-xs px-1.5 py-0.5 rounded border ${CAT_COLOR[item.category] || CAT_COLOR.case}`}>
                {CAT_LABEL[item.category] || item.category}
              </span>
              <span className="text-xs text-gray-400 line-through">{Number(item.prevPrice).toLocaleString()}원</span>
            </div>
          </div>
          <div className="flex-shrink-0 text-right">
            <div className="text-sm font-semibold text-gray-900">{Number(item.price).toLocaleString()}원</div>
            <div className="text-xs font-bold text-green-600">
              ▼ {item.dropPct}% ({Number(item.dropAmt).toLocaleString()}원↓)
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

const FEATURED_BUDGET = 1500000;
const FEATURED_PART_LABELS = { cpu: "CPU", gpu: "GPU", motherboard: "메인보드", memory: "메모리", storage: "저장장치", psu: "파워", cooler: "쿨러", case: "케이스" };

function FeaturedRecommend() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/recommend/budget-set-v2?budget=${FEATURED_BUDGET}`)
      .then((r) => {
        if (r.status === 503) { if (!cancelled) setStatus("unavailable"); return null; }
        if (!r.ok) { if (!cancelled) setStatus("unavailable"); return null; }
        return r.json();
      })
      .then((d) => {
        if (!cancelled && d?.parts) { setData(d); setStatus("ready"); }
      })
      .catch(() => { if (!cancelled) setStatus("unavailable"); });
    return () => { cancelled = true; };
  }, []);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="w-7 h-7 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (status === "unavailable" || !data) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        견적을 준비 중입니다. 잠시 후 다시 확인하세요.
      </div>
    );
  }

  const parts = Object.entries(FEATURED_PART_LABELS)
    .map(([key, label]) => ({ key, label, part: data.parts[key] }))
    .filter(({ part }) => part);

  return (
    <div>
      {data.summary && (
        <div className="mb-4 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl text-blue-700 text-sm text-center">
          {data.summary}
        </div>
      )}
      <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
        {parts.map(({ key, label, part }) => (
          <Link
            key={key}
            to={`/detail/${key}/${encodeURIComponent(part.name)}`}
            className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-gray-50 transition-colors group"
          >
            <span className="text-xs font-semibold text-gray-500 w-16 flex-shrink-0">{label}</span>
            <span className="text-sm text-gray-900 truncate flex-1 group-hover:text-blue-600 transition-colors">{part.name}</span>
            <span className="text-sm font-semibold text-gray-900 flex-shrink-0">
              {Number(part.price).toLocaleString()}원
            </span>
          </Link>
        ))}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
          <span className="text-sm text-gray-500">총 견적</span>
          <span className="text-lg font-bold text-gray-900">{Number(data.totalPrice).toLocaleString()}원</span>
        </div>
      </div>
      <div className="mt-4 text-center">
        <Button
          variant="outline"
          className="border-blue-200 text-blue-600 hover:bg-blue-50 hover:text-blue-700"
          onClick={() => navigate("/ai-recommend")}
        >
          내 예산으로 맞춤 견적 받기 →
        </Button>
      </div>
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const [heroSearch, setHeroSearch] = useState("");
  const heroInputRef = useRef(null);

  useEffect(() => {
    document.title = "가성비PC - AI 기반 가성비 PC 견적 추천";
  }, []);

  const handleHeroSearch = (e) => {
    e.preventDefault();
    if (heroSearch.trim()) {
      navigate(`/search?q=${encodeURIComponent(heroSearch.trim())}`);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Hero + 검색 */}
      <section className="px-4 sm:px-6 lg:px-8 py-20 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-4xl mx-auto text-center">
          <Badge variant="secondary" className="mb-4 bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 transition-all animate-fade-in-up">
            AI 기반 가성비 PC 견적 추천
          </Badge>
          <h1 className="text-5xl md:text-7xl font-bold mb-6 bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
            가성비PC
          </h1>
          <p className="text-xl text-gray-600 leading-relaxed mb-8 max-w-2xl mx-auto font-medium animate-fade-in-up" style={{ animationDelay: "0.4s" }}>
            신뢰할 수 있는 가격과 성능 데이터를 바탕으로 PC 부품을 탐색할 수 있는 사이트입니다.
            <span className="text-blue-600 font-semibold"> 최적의 가성비</span>를 찾아보세요.
          </p>

          {/* 인라인 검색창 */}
          <form
            onSubmit={handleHeroSearch}
            className="flex items-center gap-2 max-w-xl mx-auto mb-6 animate-fade-in-up"
            style={{ animationDelay: "0.5s" }}
          >
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                ref={heroInputRef}
                type="text"
                value={heroSearch}
                onChange={(e) => setHeroSearch(e.target.value)}
                placeholder="부품명 검색 (예: RTX 4070, Ryzen 7 9800X3D)"
                className="w-full pl-10 pr-4 py-3 text-sm rounded-xl border border-gray-300 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
              />
            </div>
            <button
              type="submit"
              className="px-5 py-3 text-sm font-medium bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-sm flex-shrink-0"
            >
              검색
            </button>
          </form>

          <div className="flex flex-col sm:flex-row gap-3 justify-center animate-fade-in-up" style={{ animationDelay: "0.6s" }}>
            <Button
              size="lg"
              className="text-base px-8 bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
              onClick={() => navigate("/ai-recommend")}
            >
              <Sparkles className="w-4 h-4 mr-2" />
              AI 추천 받기
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="text-base px-8 border-gray-300 text-gray-700 hover:bg-gray-50"
              onClick={() => navigate("/pc-builder")}
            >
              직접 견적 짜기
            </Button>
          </div>
        </div>
      </section>

      {/* 통계 스트립 */}
      <section className="border-y border-gray-100 bg-gray-50">
        <div className="px-4 sm:px-6 lg:px-8 py-5 max-w-4xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {STATS.map(({ label, Icon }, i) => (
              <div key={i} className="flex items-center justify-center gap-2 text-gray-600 text-sm font-medium">
                <Icon className="w-4 h-4 text-blue-500 flex-shrink-0" />
                {label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 카테고리 */}
      <section className="px-4 sm:px-6 lg:px-8 py-16">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold mb-3 text-gray-900">카테고리별 탐색</h2>
            <p className="text-base text-gray-500">원하는 부품 카테고리를 선택하여 가격·성능을 비교하세요</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {CATEGORIES.map(({ title, href, Icon, color }, i) => (
              <Link
                key={i}
                to={href}
                className="group flex items-center gap-3 px-4 py-4 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-md transition-all duration-200 animate-fade-in-up"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <Icon className={`w-5 h-5 ${color} flex-shrink-0 group-hover:scale-110 transition-transform duration-200`} />
                <span className="text-sm font-semibold text-gray-800 group-hover:text-blue-700 transition-colors">{title}</span>
                <ChevronRight className="w-4 h-4 text-gray-300 ml-auto group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* AI 추천 예시 */}
      <section className="px-4 sm:px-6 lg:px-8 py-12 bg-gray-50">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <Badge variant="secondary" className="mb-3 bg-indigo-50 border-indigo-200 text-indigo-700">
              <Sparkles className="w-3.5 h-3.5 mr-1" />
              AI 추천 예시
            </Badge>
            <h2 className="text-3xl font-bold text-gray-900 mb-2">150만원 최적 가성비 견적</h2>
            <p className="text-gray-500">AI가 DB 실제 가격 기준으로 선정한 가성비 최강 조합입니다.</p>
          </div>
          <Card className="bg-white border-gray-200 shadow-sm">
            <CardContent className="pt-6">
              <FeaturedRecommend />
            </CardContent>
          </Card>
        </div>
      </section>

      {/* 가격 하락 */}
      <section className="px-4 sm:px-6 lg:px-8 py-12">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <Badge variant="secondary" className="mb-3 bg-green-50 border-green-200 text-green-700">
              <TrendingDown className="w-3.5 h-3.5 mr-1" />
              실시간 가격 정보
            </Badge>
            <h2 className="text-3xl font-bold text-gray-900 mb-2">최근 가격 하락 TOP 10</h2>
            <p className="text-gray-500">최근 30일 대비 가격이 가장 많이 내린 부품입니다.</p>
          </div>
          <Card className="bg-white border-gray-200 shadow-sm">
            <CardContent className="pt-6 px-0 pb-0">
              <PriceDrops />
            </CardContent>
          </Card>
        </div>
      </section>

      {/* 주요 기능 */}
      <section className="px-4 sm:px-6 lg:px-8 py-16 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-3 text-gray-900">주요 기능</h2>
            <p className="text-base text-gray-500 font-medium">가성비PC만의 특별한 기능들을 만나보세요</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {FEATURES.map(({ title, description, Icon }, i) => (
              <Card
                key={i}
                className="text-center bg-white border-gray-200 hover:shadow-md transition-all duration-300 hover:scale-105 animate-fade-in-up"
                style={{ animationDelay: `${i * 200}ms` }}
              >
                <CardHeader>
                  <div className="flex justify-center mb-3">
                    <div className="p-3 rounded-xl bg-blue-50">
                      <Icon className="w-6 h-6 text-blue-600" />
                    </div>
                  </div>
                  <CardTitle className="text-lg font-bold text-gray-900">{title}</CardTitle>
                  <p className="text-sm text-gray-500 font-medium">{description}</p>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}
