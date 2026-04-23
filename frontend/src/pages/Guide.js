import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";

const ARTICLES = [
  {
    id: "budget-pc",
    title: "예산별 PC 조립 가이드",
    summary: "예산에 맞는 PC 구성을 선택하는 방법과 부품 배분 비율을 안내합니다.",
    content: `PC를 조립할 때 가장 먼저 정해야 할 것은 예산입니다. 예산 범위에 따라 CPU·GPU·메모리 등에 투자하는 비율이 달라지며, 용도(게임, 작업, 사무)에 맞게 배분하는 것이 중요합니다.

일반적으로 게임용 PC는 전체 예산의 35~45% 정도를 GPU에 할당하는 것이 좋습니다. CPU는 20~25%, 메인보드와 메모리는 각각 10~15% 수준으로 잡으면 균형 있는 구성이 됩니다. 사무용이나 웹·영상 시청 위주라면 GPU 비중을 낮추고 CPU와 SSD에 더 투자하는 편이 좋습니다.

GoodPricePC에서는 AI 견적 추천 기능으로 예산과 용도(게임용·작업용·사무용·가성비)를 입력하면 호환되는 부품 조합을 추천받을 수 있습니다. 카테고리별로 가성비순·가격순 정렬을 활용해 본인 예산에 맞는 제품을 비교해 보시기 바랍니다.`,
  },
  {
    id: "cpu-selection",
    title: "CPU 선택 방법: 코어 수와 용도",
    summary: "용도에 맞는 CPU를 고르기 위한 코어·스레드·클럭 이해와 가성비 포인트를 설명합니다.",
    content: `CPU는 PC의 두뇌 역할을 하며, 작업 종류에 따라 필요한 성능이 다릅니다. 게임은 대부분 6코어~8코어에서도 충분한 경우가 많고, 영상 인코딩·3D 렌더링·가상화 등은 코어와 스레드 수가 많을수록 유리합니다.

PassMark·Cinebench 같은 벤치마크 점수는 성능을 한눈에 비교하는 데 도움이 됩니다. 단순히 점수만 높은 제품보다는, 예산 대비 성능 비율(가성비)이 좋은 제품을 고르는 것이 중요합니다. GoodPricePC의 CPU 카테고리에서는 가성비순 정렬로 성능 대비 가격이 좋은 순서대로 목록을 확인할 수 있습니다.

또한 메인보드와의 호환성(소켓·칩셋)을 반드시 확인해야 합니다. AMD AM5·AM4, Intel LGA1700 등 소켓이 맞아야 조립이 가능하므로, 메인보드를 먼저 정했다면 해당 소켓을 지원하는 CPU만 필터링해 보시면 됩니다.`,
  },
  {
    id: "gpu-selection",
    title: "GPU(그래픽카드) 선택 가이드",
    summary: "게임·작업 용도별 GPU 선택 기준과 VRAM, 해상도별 추천 포인트를 안내합니다.",
    content: `그래픽카드(GPU)는 게임 화질과 프레임, 그리고 영상 편집·3D 작업 성능에 직결됩니다. 해상도와 목표 프레임에 따라 필요한 GPU 등급이 달라지므로, 1080p·1440p·4K 중 어떤 환경에서 사용할지 먼저 정하는 것이 좋습니다.

VRAM(비디오 메모리)은 1080p 기준 6GB 이상, 1440p는 8GB 이상, 4K나 고해상도 텍스처를 쓰는 최신 게임은 12GB 이상을 권장합니다. 작업용(렌더링·AI 학습)은 용도에 따라 8GB~24GB 이상을 고려할 수 있습니다.

GoodPricePC의 GPU 카테고리에서는 3DMark 점수순·가성비순 정렬로 성능과 가격을 함께 비교할 수 있습니다. NVIDIA와 AMD 제품을 필터로 나눠 보시면 브랜드별로 가성비 좋은 모델을 빠르게 찾을 수 있습니다.`,
  },
];

export default function Guide() {
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-12 max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-bold text-white mb-3">PC 부품 가이드</h1>
        <p className="text-lg text-slate-300">
          예산·용도에 맞는 부품 선택을 위한 가이드 글입니다. GoodPricePC 데이터와 함께 활용해 보세요.
        </p>
      </div>

      <div className="space-y-8">
        {ARTICLES.map((article) => (
          <Card key={article.id} className="bg-white/90 backdrop-blur-sm border-slate-200/50">
            <CardHeader>
              <CardTitle className="text-slate-800 text-xl">{article.title}</CardTitle>
              <p className="text-sm text-slate-500">{article.summary}</p>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-slate-600 leading-relaxed whitespace-pre-line">
                {article.content}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap gap-4 justify-center">
        <Link to="/" className="inline-flex items-center px-5 py-2.5 rounded-lg bg-white/20 text-white hover:bg-white/30 font-medium transition-colors">
          ← 홈으로
        </Link>
        <Link to="/ai-recommend" className="inline-flex items-center px-5 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium transition-colors">
          AI 견적 추천
        </Link>
        <Link to="/about" className="inline-flex items-center px-5 py-2.5 rounded-lg bg-white/20 text-white hover:bg-white/30 font-medium transition-colors">
          사이트 소개
        </Link>
      </div>
    </div>
  );
}
