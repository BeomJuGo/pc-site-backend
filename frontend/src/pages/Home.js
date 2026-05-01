import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";

const CATEGORIES = [
  { title: "CPU", description: "프로세서 성능과 가격을 비교해보세요", href: "/category/cpu", icon: "🖥️", gradient: "from-blue-500 to-cyan-500" },
  { title: "GPU", description: "그래픽카드 성능과 가격을 확인하세요", href: "/category/gpu", icon: "🎮", gradient: "from-violet-500 to-purple-500" },
  { title: "메모리", description: "RAM 용량과 속도를 비교해보세요", href: "/category/memory", icon: "💾", gradient: "from-green-500 to-emerald-500" },
  { title: "메인보드", description: "호환성과 확장성을 고려한 선택", href: "/category/motherboard", icon: "🔌", gradient: "from-orange-500 to-red-500" },
  { title: "저장장치", description: "SSD와 HDD의 속도와 용량 비교", href: "/category/storage", icon: "💿", gradient: "from-indigo-500 to-blue-500" },
  { title: "케이스", description: "PC 케이스 크기와 쿨링 성능", href: "/category/case", icon: "📦", gradient: "from-gray-500 to-slate-500" },
  { title: "쿨러", description: "CPU 쿨러와 케이스 팬 성능", href: "/category/cooler", icon: "❄️", gradient: "from-cyan-500 to-blue-500" },
  { title: "파워", description: "파워서플라이 효율과 안정성", href: "/category/psu", icon: "⚡", gradient: "from-yellow-500 to-orange-500" },
];

const FEATURES = [
  { title: "실시간 가격 비교", description: "다양한 쇼핑몰의 최신 가격을 실시간으로 비교합니다", icon: "📊" },
  { title: "성능 데이터", description: "벤치마크 점수와 실제 성능 데이터를 제공합니다", icon: "⚡" },
  { title: "AI 추천", description: "예산과 용도에 맞는 최적의 부품을 추천합니다", icon: "🤖" },
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
          💡 {data.summary}
        </div>
      )}
      <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
        {parts.map(({ key, label, part }) => (
          <div key={key} className="flex items-center gap-3 px-4 py-3 bg-white">
            <span className="text-xs font-semibold text-gray-500 w-16 flex-shrink-0">{label}</span>
            <span className="text-sm text-gray-900 truncate flex-1">{part.name}</span>
            <span className="text-sm font-semibold text-gray-900 flex-shrink-0">
              {Number(part.price).toLocaleString()}원
            </span>
          </div>
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

  useEffect(() => {
    document.title = "GoodPricePC - AI 기반 가성비 PC 견적 추천";
  }, []);

  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <section className="px-4 sm:px-6 lg:px-8 py-20 bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-4xl mx-auto text-center">
          <Badge variant="secondary" className="mb-4 bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 transition-all animate-fade-in-up">
            ✨ 새로운 PC 부품 비교 사이트
          </Badge>
          <h1 className="text-5xl md:text-7xl font-bold mb-6 bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
            GoodPricePC
          </h1>
          <p className="text-xl text-gray-600 leading-relaxed mb-8 max-w-2xl mx-auto font-medium animate-fade-in-up" style={{ animationDelay: "0.4s" }}>
            신뢰할 수 있는 가격과 성능 데이터를 바탕으로 PC 부품을 탐색할 수 있는 사이트입니다.
            <span className="text-blue-600 font-semibold"> 최적의 가성비</span>를 찾아보세요.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center animate-fade-in-up" style={{ animationDelay: "0.6s" }}>
            <Button
              size="lg"
              className="text-base px-8 bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
              onClick={() => navigate("/ai-recommend")}
            >
              ✨ AI 추천 받기
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="text-base px-8 border-gray-300 text-gray-700 hover:bg-gray-50"
              onClick={() => navigate("/pc-builder")}
            >
              🛠️ 직접 견적 짜기
            </Button>
          </div>
        </div>
      </section>

      {/* Featured AI Recommend */}
      <section className="px-4 sm:px-6 lg:px-8 py-12">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <Badge variant="secondary" className="mb-3 bg-indigo-50 border-indigo-200 text-indigo-700">
              ✨ AI 추천 예시
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

      {/* Price Drops */}
      <section className="px-4 sm:px-6 lg:px-8 py-12 bg-gray-50">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <Badge variant="secondary" className="mb-3 bg-green-50 border-green-200 text-green-700">
              📉 실시간 가격 정보
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

      {/* Categories */}
      <section className="px-4 sm:px-6 lg:px-8 py-16">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold mb-4 text-gray-900">카테고리별 탐색</h2>
            <p className="text-lg text-gray-500 font-medium">원하는 부품 카테고리를 선택하여 상세 정보를 확인하세요</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {CATEGORIES.map((cat, i) => (
              <Card
                key={i}
                className="group hover:shadow-md transition-all duration-300 cursor-pointer bg-white border-gray-200 hover:border-gray-300 hover:scale-105 hover:-translate-y-1 animate-fade-in-up"
                style={{ animationDelay: `${i * 100}ms` }}
                onClick={() => navigate(cat.href)}
              >
                <CardHeader className="text-center pb-4">
                  <div className="text-5xl mb-3 group-hover:scale-110 transition-transform duration-300">{cat.icon}</div>
                  <CardTitle className="text-xl font-bold text-gray-900">{cat.title}</CardTitle>
                  <CardDescription className="text-gray-500 font-medium">{cat.description}</CardDescription>
                </CardHeader>
                <CardContent className="text-center pt-0">
                  <Button
                    variant="outline"
                    className={`w-full bg-gradient-to-r ${cat.gradient} text-white border-0 hover:shadow-md transition-all duration-300 hover:scale-105`}
                  >
                    탐색하기
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="px-4 sm:px-6 lg:px-8 py-16 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold mb-4 text-gray-900">주요 기능</h2>
            <p className="text-lg text-gray-500 font-medium">GoodPricePC만의 특별한 기능들을 만나보세요</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {FEATURES.map((feature, i) => (
              <Card
                key={i}
                className="text-center bg-white border-gray-200 hover:shadow-md transition-all duration-300 hover:scale-105 animate-fade-in-up"
                style={{ animationDelay: `${i * 200}ms` }}
              >
                <CardHeader>
                  <div className="text-4xl mb-3">{feature.icon}</div>
                  <CardTitle className="text-xl font-bold text-gray-900">{feature.title}</CardTitle>
                  <CardDescription className="text-base text-gray-500 font-medium">{feature.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 sm:px-6 lg:px-8 py-16">
        <div className="max-w-4xl mx-auto text-center">
          <Card className="bg-gray-900 text-white border-0 shadow-xl hover:shadow-2xl transition-all duration-300 animate-fade-in-up">
            <CardHeader>
              <CardTitle className="text-4xl mb-4 font-bold">🚀 지금 시작하세요</CardTitle>
              <CardDescription className="text-gray-300 text-xl font-medium">
                AI 추천을 통해 최적의 PC 구성을 찾아보세요
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                size="lg"
                className="text-lg px-8 py-4 bg-blue-600 text-white hover:bg-blue-700 shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300"
                onClick={() => navigate("/ai-recommend")}
              >
                ✨ AI 추천 받기
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="text-lg px-8 py-4 bg-transparent text-white border-white/30 hover:bg-white/10 shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300"
                onClick={() => navigate("/pc-builder")}
              >
                🛠️ 직접 견적 짜기
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
