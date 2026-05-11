import { useState } from "react";
import { Link } from "react-router-dom";
import { useSeoMeta } from "../hooks/useSeoMeta";

const LAST_UPDATED = "2026-05-11";

const BUDGET_ROWS = [
  { budget: "50만원 이하", purpose: "사무·인터넷·유튜브", cpu: "i3-12100F / Ryzen 5 5500", gpu: "내장그래픽 or GT 1030", ram: "16GB DDR4", storage: "500GB NVMe SSD", tip: "게임 불가, 문서·영상 시청 최적" },
  { budget: "70~90만원", purpose: "가벼운 게임·사무", cpu: "Ryzen 5 5600", gpu: "RTX 3060 / RX 6600", ram: "16GB DDR4", storage: "1TB NVMe SSD", tip: "FHD 60fps 게임 가능, 가성비 최고 구간" },
  { budget: "100~130만원", purpose: "FHD 고프레임 게이밍", cpu: "Ryzen 5 7600 / i5-13400F", gpu: "RTX 4060 / RX 7600 XT", ram: "16GB DDR5", storage: "1TB NVMe SSD", tip: "FHD 144fps 안정적, 가성비·성능 균형" },
  { budget: "150~200만원", purpose: "QHD 게이밍·영상편집", cpu: "Ryzen 7 7800X3D / i5-14600K", gpu: "RTX 4070 / RX 7800 XT", ram: "32GB DDR5", storage: "1TB NVMe SSD", tip: "QHD 고프레임, X3D는 게임 성능 최상" },
  { budget: "250~300만원", purpose: "4K 게이밍·전문 작업", cpu: "Ryzen 9 9800X3D / i9-14900K", gpu: "RTX 4080 Super / RX 7900 XTX", ram: "32GB DDR5", storage: "2TB NVMe SSD", tip: "최고 사양, 4K·스트리밍·3D 작업 가능" },
];

const FAQ = [
  {
    q: "조립 PC와 완제품 중 어느 것이 더 가성비가 좋나요?",
    a: "같은 예산이면 조립 PC가 완제품보다 성능이 20~40% 높습니다. 완제품은 조립·AS 편의성을 제공하지만 부품 단가가 높고 업그레이드가 어렵습니다. 100만원 이상 예산이라면 조립 PC가 훨씬 유리합니다.",
  },
  {
    q: "PC 조립 경험이 없어도 직접 조립할 수 있나요?",
    a: "네, 가능합니다. 유튜브에 조립 튜토리얼이 많고, 현재 PC 조립은 레고처럼 맞춰 끼우는 수준입니다. 다만 정전기 방지(맨손으로 금속 터치), CPU 핀 조심, 케이블 연결 순서만 주의하면 됩니다. 조립 대행 서비스를 이용하면 공임비 3~8만원으로 전문가가 조립해 줍니다.",
  },
  {
    q: "CPU와 GPU 중 어디에 예산을 더 써야 하나요?",
    a: "게임 용도라면 GPU에 40~45%, CPU에 20~25%를 배분하는 것이 일반적입니다. 영상 편집·3D 렌더링 등 작업 용도라면 CPU와 메모리 용량에 더 투자하는 것이 좋습니다. AI·딥러닝 작업은 GPU VRAM이 핵심입니다.",
  },
  {
    q: "메모리(RAM)는 얼마나 필요한가요?",
    a: "2026년 기준 16GB는 기본, 32GB는 권장입니다. 게임 단독 사용은 16GB로 충분하지만, 크롬 탭을 많이 열거나 게임+스트리밍을 동시에 한다면 32GB를 추천합니다. 영상 편집·3D 작업은 32GB 이상이 필요합니다.",
  },
  {
    q: "SSD와 HDD 중 무엇을 선택해야 하나요?",
    a: "운영체제와 주 사용 프로그램은 반드시 NVMe SSD에 설치해야 합니다. HDD 대비 부팅 속도가 10배 이상 빠릅니다. 용량이 많이 필요하다면 NVMe SSD(OS용) + HDD(저장용) 조합이 가성비 면에서 유리합니다.",
  },
  {
    q: "파워서플라이(PSU) 용량은 어떻게 정하나요?",
    a: "CPU TDP + GPU TDP의 합에 1.5~2배 여유를 두는 것이 안전합니다. 예를 들어 RTX 4070(200W) + Ryzen 7(65W)라면 총 265W × 1.5 = 400W 이상, 실제로는 650W 80+ 인증 제품을 권장합니다. 파워는 저렴한 것보다 인증된 브랜드(시소닉, 마이크로닉스, FSP)를 선택하는 것이 중요합니다.",
  },
];

const ARTICLES = [
  {
    id: "budget-guide",
    title: "2026년 예산별 가성비 PC 조립 견적 가이드",
    summary: "50만원부터 300만원까지 예산 구간별 최적 부품 구성과 용도별 추천 포인트를 정리했습니다.",
    render: () => (
      <div className="space-y-5 text-gray-600 leading-relaxed">
        <p>
          PC를 처음 조립할 때 가장 먼저 정해야 할 것은 <strong>예산</strong>과 <strong>용도</strong>입니다.
          같은 예산이라도 게임용·작업용·사무용에 따라 부품 배분이 크게 달라집니다.
          아래 표는 2026년 기준 예산 구간별 추천 구성입니다.
        </p>

        <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-3">예산별 추천 구성표</h3>
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-blue-50">
                <th className="border border-gray-200 px-3 py-2 text-left font-semibold text-gray-700">예산</th>
                <th className="border border-gray-200 px-3 py-2 text-left font-semibold text-gray-700">용도</th>
                <th className="border border-gray-200 px-3 py-2 text-left font-semibold text-gray-700">CPU</th>
                <th className="border border-gray-200 px-3 py-2 text-left font-semibold text-gray-700">GPU</th>
                <th className="border border-gray-200 px-3 py-2 text-left font-semibold text-gray-700">RAM</th>
                <th className="border border-gray-200 px-3 py-2 text-left font-semibold text-gray-700">한줄 평</th>
              </tr>
            </thead>
            <tbody>
              {BUDGET_ROWS.map((row, i) => (
                <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                  <td className="border border-gray-200 px-3 py-2 font-medium text-blue-700 whitespace-nowrap">{row.budget}</td>
                  <td className="border border-gray-200 px-3 py-2 whitespace-nowrap">{row.purpose}</td>
                  <td className="border border-gray-200 px-3 py-2 text-xs">{row.cpu}</td>
                  <td className="border border-gray-200 px-3 py-2 text-xs">{row.gpu}</td>
                  <td className="border border-gray-200 px-3 py-2 text-xs whitespace-nowrap">{row.ram}</td>
                  <td className="border border-gray-200 px-3 py-2 text-xs text-gray-500">{row.tip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="text-lg font-semibold text-gray-800 mt-6 mb-2">부품별 예산 배분 원칙</h3>
        <ul className="list-disc list-inside space-y-1.5">
          <li><strong>게임용:</strong> GPU 40~45% / CPU 20~25% / 메인보드+메모리 20% / 나머지 부품 15%</li>
          <li><strong>작업용(영상편집·3D):</strong> CPU 30% / GPU 30% / 메모리 20% / 나머지 20%</li>
          <li><strong>사무용:</strong> CPU 35% / SSD 20% / 메인보드+메모리 30% / GPU 최소화</li>
        </ul>

        <p className="text-sm text-blue-600 mt-4">
          → <Link to="/ai-recommend" className="underline hover:text-blue-800">AI 견적 추천</Link>에서 예산을 입력하면 자동으로 최적 구성을 추천받을 수 있습니다.
        </p>
      </div>
    ),
  },
  {
    id: "cpu-selection",
    title: "CPU 선택 방법: 게임용 vs 작업용 차이와 2026년 추천",
    summary: "AMD Ryzen과 Intel Core 중 용도에 맞는 CPU를 고르는 기준과 2026년 가성비 모델을 설명합니다.",
    render: () => (
      <div className="space-y-4 text-gray-600 leading-relaxed">
        <p>
          CPU는 PC 성능의 핵심입니다. <strong>게임용</strong>이라면 클럭 속도와 캐시가 중요하고,
          <strong>작업용</strong>이라면 코어·스레드 수가 많을수록 유리합니다.
        </p>

        <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">게임용 CPU 추천 (2026년 기준)</h3>
        <ul className="list-disc list-inside space-y-1.5">
          <li><strong>Ryzen 7 9800X3D</strong> — 3D V-Cache 기술로 게임 성능 1위, 고예산 게이밍에 최적</li>
          <li><strong>Ryzen 7 7800X3D</strong> — 전세대 최강 게이밍 CPU, 가성비 우수</li>
          <li><strong>Ryzen 5 7600 / i5-13400F</strong> — 100~150만원 구간 최고 가성비</li>
        </ul>

        <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">작업용 CPU 추천</h3>
        <ul className="list-disc list-inside space-y-1.5">
          <li><strong>Ryzen 9 9950X / i9-14900K</strong> — 최고 멀티코어 성능, 전문 작업용</li>
          <li><strong>Ryzen 7 9700X / i7-14700K</strong> — 가성비 작업용, 영상 편집·스트리밍</li>
          <li><strong>Intel i5-14600K</strong> — P코어+E코어 조합, 게임+작업 겸용</li>
        </ul>

        <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">소켓 호환성 필수 확인</h3>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>AMD Ryzen 7000·9000 시리즈 → <strong>AM5 소켓</strong> 메인보드</li>
          <li>AMD Ryzen 5000 시리즈 → <strong>AM4 소켓</strong> 메인보드</li>
          <li>Intel 12·13·14세대 → <strong>LGA1700 소켓</strong> 메인보드</li>
          <li>Intel 15세대(Arrow Lake) → <strong>LGA1851 소켓</strong> 메인보드</li>
        </ul>

        <p className="text-sm text-blue-600 mt-3">
          → <Link to="/category/cpu" className="underline hover:text-blue-800">CPU 가격비교 바로가기</Link>
        </p>
      </div>
    ),
  },
  {
    id: "gpu-selection",
    title: "GPU(그래픽카드) 선택 가이드: 해상도·VRAM·용도별 추천",
    summary: "FHD·QHD·4K 해상도별 필요 GPU 등급과 NVIDIA vs AMD 선택 기준을 안내합니다.",
    render: () => (
      <div className="space-y-4 text-gray-600 leading-relaxed">
        <p>
          그래픽카드(GPU)는 게임 프레임과 화질, 영상 편집·3D 렌더링 성능을 결정합니다.
          <strong>해상도와 목표 프레임</strong>을 먼저 정한 뒤 GPU를 선택하세요.
        </p>

        <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">해상도별 추천 GPU 등급</h3>
        <ul className="list-disc list-inside space-y-2">
          <li>
            <strong>FHD(1920×1080) 60fps</strong> — RTX 3060 / RX 6600 수준 (VRAM 8GB+)
          </li>
          <li>
            <strong>FHD 144fps 이상</strong> — RTX 4060 / RX 7600 XT 이상 (VRAM 8GB+)
          </li>
          <li>
            <strong>QHD(2560×1440) 게이밍</strong> — RTX 4070 / RX 7800 XT 이상 (VRAM 12GB+)
          </li>
          <li>
            <strong>4K(3840×2160)</strong> — RTX 4080 / RX 7900 XTX 이상 (VRAM 16GB+)
          </li>
        </ul>

        <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">NVIDIA vs AMD 선택 기준</h3>
        <ul className="list-disc list-inside space-y-1.5">
          <li><strong>NVIDIA 추천:</strong> 영상 편집(NVENC 인코더), AI·CUDA 활용, DLSS 업스케일링</li>
          <li><strong>AMD 추천:</strong> 같은 가격에 더 높은 래스터라이징 성능, FSR 지원</li>
          <li>순수 게임 용도라면 두 브랜드 모두 우수하며 가격 대비 성능으로 선택</li>
        </ul>

        <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">VRAM 권장 용량</h3>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>FHD 게임: 8GB 이상</li>
          <li>QHD·최신 AAA 게임: 12GB 이상</li>
          <li>4K·고해상도 텍스처: 16GB 이상</li>
          <li>AI·딥러닝 작업: 24GB 이상 권장</li>
        </ul>

        <p className="text-sm text-blue-600 mt-3">
          → <Link to="/category/gpu" className="underline hover:text-blue-800">GPU 가격비교 바로가기</Link>
        </p>
      </div>
    ),
  },
  {
    id: "memory-storage",
    title: "메모리(RAM)·SSD 선택 방법: 용량과 규격 완벽 정리",
    summary: "DDR4 vs DDR5, 메모리 용량별 차이, NVMe SSD vs SATA SSD 선택 기준을 설명합니다.",
    render: () => (
      <div className="space-y-4 text-gray-600 leading-relaxed">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">메모리(RAM) 선택 기준</h3>
        <p>
          2026년 기준 <strong>16GB는 기본, 32GB는 권장</strong>입니다.
          게임만 한다면 16GB로 충분하지만, 크롬 멀티태스킹이나 게임+스트리밍 동시 사용이라면 32GB를 권장합니다.
        </p>
        <ul className="list-disc list-inside space-y-1.5 mt-2">
          <li><strong>DDR4</strong> — AM4·LGA1700 구형 플랫폼 호환, 가격 저렴</li>
          <li><strong>DDR5</strong> — AM5·LGA1851 최신 플랫폼 전용, 대역폭 높고 미래 지향적</li>
          <li>메인보드 스펙에서 지원 규격을 먼저 확인 후 선택</li>
          <li>듀얼채널 구성(8GB×2 또는 16GB×2)이 싱글채널 대비 성능 10~20% 향상</li>
        </ul>

        <h3 className="text-lg font-semibold text-gray-800 mt-5 mb-2">SSD 선택 기준</h3>
        <ul className="list-disc list-inside space-y-1.5">
          <li><strong>NVMe SSD(M.2)</strong> — 읽기 속도 3,500MB/s 이상, OS 설치 필수 권장</li>
          <li><strong>SATA SSD</strong> — 읽기 속도 550MB/s 수준, 가격 저렴, 데이터 보관용</li>
          <li><strong>HDD</strong> — 대용량 저장(4TB~), 속도 느림, 영상·음악 파일 보관용</li>
        </ul>
        <p className="mt-2 text-sm">
          추천 조합: <strong>NVMe SSD 1TB(OS+게임) + HDD 2TB(미디어 저장)</strong>
        </p>

        <p className="text-sm text-blue-600 mt-3">
          → <Link to="/category/memory" className="underline hover:text-blue-800">메모리 가격비교</Link>
          &nbsp;·&nbsp;
          <Link to="/category/storage" className="underline hover:text-blue-800">SSD 가격비교</Link>
        </p>
      </div>
    ),
  },
  {
    id: "psu-case-cooler",
    title: "파워·케이스·쿨러 선택 가이드: 놓치기 쉬운 부품",
    summary: "PC 안정성을 좌우하는 파워서플라이 용량 계산법, 케이스 폼팩터, 쿨러 등급 선택 방법을 안내합니다.",
    render: () => (
      <div className="space-y-4 text-gray-600 leading-relaxed">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">파워서플라이(PSU) 용량 계산</h3>
        <p>
          파워는 PC 안정성의 핵심입니다. <strong>CPU TDP + GPU TDP × 1.5~2배</strong>를 기준으로 선택하세요.
          80+ Bronze 이상 인증 제품을 권장하며, 신뢰할 수 있는 브랜드(시소닉, 마이크로닉스, FSP, SuperFlower)를 선택하는 것이 중요합니다.
        </p>
        <ul className="list-disc list-inside space-y-1 text-sm mt-2">
          <li>RTX 4060 + Ryzen 5: 650W 권장</li>
          <li>RTX 4070 + Ryzen 7: 750W 권장</li>
          <li>RTX 4080 + Ryzen 9: 850W 이상 권장</li>
        </ul>

        <h3 className="text-lg font-semibold text-gray-800 mt-5 mb-2">케이스 선택 기준</h3>
        <ul className="list-disc list-inside space-y-1.5">
          <li><strong>ATX 풀타워·미드타워</strong> — 쿨링 우수, 확장성 높음, 일반 권장</li>
          <li><strong>Micro-ATX</strong> — 부피 작고 가격 저렴, 확장 슬롯 제한</li>
          <li><strong>Mini-ITX</strong> — 소형 PC, 고급 쿨링 솔루션 필요</li>
          <li>GPU 길이, CPU 쿨러 높이 제한 스펙 반드시 확인</li>
        </ul>

        <h3 className="text-lg font-semibold text-gray-800 mt-5 mb-2">CPU 쿨러 선택</h3>
        <ul className="list-disc list-inside space-y-1.5">
          <li><strong>기본 박스 쿨러</strong> — TDP 65W 이하 CPU에만 권장</li>
          <li><strong>타워형 공랭 쿨러</strong> — 가성비 우수, TDP 125W 이하 적합 (딥쿨, Thermalright)</li>
          <li><strong>240mm 수랭(AIO)</strong> — 고TDP CPU(125W+), 조용한 환경 원할 때</li>
          <li>오버클럭 시 반드시 전용 쿨러 필요</li>
        </ul>

        <p className="text-sm text-blue-600 mt-3">
          → <Link to="/category/psu" className="underline hover:text-blue-800">파워 가격비교</Link>
          &nbsp;·&nbsp;
          <Link to="/category/cooler" className="underline hover:text-blue-800">쿨러 가격비교</Link>
          &nbsp;·&nbsp;
          <Link to="/category/case" className="underline hover:text-blue-800">케이스 가격비교</Link>
        </p>
      </div>
    ),
  },
  {
    id: "compatibility",
    title: "PC 부품 호환성 완벽 체크리스트",
    summary: "조립 전 반드시 확인해야 할 소켓·메모리 규격·케이스 크기 등 호환성 체크 항목을 정리합니다.",
    render: () => (
      <div className="space-y-4 text-gray-600 leading-relaxed">
        <p>
          부품을 구매하기 전에 아래 호환성을 반드시 확인하세요. 한 가지라도 맞지 않으면 조립이 불가능합니다.
        </p>
        <ol className="list-decimal list-inside space-y-3">
          <li>
            <strong>CPU ↔ 메인보드 소켓</strong>
            <p className="ml-5 mt-1 text-sm">AM5/AM4/LGA1700/LGA1851 소켓이 일치해야 합니다.</p>
          </li>
          <li>
            <strong>메모리 규격 ↔ 메인보드</strong>
            <p className="ml-5 mt-1 text-sm">DDR4/DDR5 규격과 지원 속도(클럭) 확인. DDR4·DDR5는 슬롯 형태가 달라 물리적으로 호환 불가.</p>
          </li>
          <li>
            <strong>메인보드 폼팩터 ↔ 케이스 크기</strong>
            <p className="ml-5 mt-1 text-sm">ATX 보드는 ATX·풀타워 케이스에, Micro-ATX는 mATX 이상 케이스에 장착 가능.</p>
          </li>
          <li>
            <strong>GPU 길이 ↔ 케이스 GPU 지원 길이</strong>
            <p className="ml-5 mt-1 text-sm">고성능 GPU는 길이 330mm 이상이므로 케이스 스펙 확인 필수.</p>
          </li>
          <li>
            <strong>CPU 쿨러 높이 ↔ 케이스 쿨러 지원 높이</strong>
            <p className="ml-5 mt-1 text-sm">타워형 쿨러는 보통 150~160mm, 케이스의 CPU 쿨러 지원 높이 확인.</p>
          </li>
          <li>
            <strong>파워서플라이 용량 ↔ 전체 소비전력</strong>
            <p className="ml-5 mt-1 text-sm">CPU+GPU TDP 합산 × 1.5 이상 여유 확보.</p>
          </li>
        </ol>
        <p className="text-sm text-blue-600 mt-3">
          → <Link to="/pc-builder" className="underline hover:text-blue-800">PC 빌더</Link>에서 부품을 선택하면 호환성을 자동으로 확인할 수 있습니다.
        </p>
      </div>
    ),
  },
];

export default function Guide() {
  const [openFaq, setOpenFaq] = useState(null);

  useSeoMeta({
    title: "PC 조립 가이드 2026 | 예산별 견적·부품 선택법 | 가성비PC",
    description: "2026년 가성비 PC 조립 가이드. 예산별 견적 추천, CPU·GPU·메모리·SSD 선택 방법, 호환성 체크리스트까지 완벽 정리.",
    path: "/guide",
  });

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-12 max-w-3xl mx-auto">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": FAQ.map((f) => ({
              "@type": "Question",
              "name": f.q,
              "acceptedAnswer": { "@type": "Answer", "text": f.a },
            })),
          }),
        }}
      />

      <div className="text-center mb-10">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-3">
          PC 조립 가이드 2026
        </h1>
        <p className="text-lg text-gray-600">
          처음 PC를 조립하는 분을 위한 예산별 견적·부품 선택 완벽 가이드
        </p>
        <p className="text-xs text-gray-400 mt-2">최종 업데이트: {LAST_UPDATED}</p>
      </div>

      <div className="space-y-8 mb-14">
        {ARTICLES.map((article) => (
          <ArticleCard key={article.id} article={article} />
        ))}
      </div>

      <div className="mb-14">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">자주 묻는 질문 (FAQ)</h2>
        <div className="space-y-3">
          {FAQ.map((item, i) => (
            <div key={i} className="border border-gray-200 rounded-lg overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-5 py-4 text-left bg-white hover:bg-gray-50 transition-colors"
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
              >
                <span className="font-medium text-gray-800 pr-4">{item.q}</span>
                <span className="text-gray-400 shrink-0 text-lg">{openFaq === i ? "−" : "+"}</span>
              </button>
              {openFaq === i && (
                <div className="px-5 pb-4 text-gray-600 leading-relaxed text-sm bg-gray-50 border-t border-gray-100">
                  {item.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-blue-50 rounded-xl p-6 mb-8 text-center">
        <h2 className="text-xl font-bold text-gray-900 mb-2">가이드를 읽었다면 AI 견적 추천을 받아보세요</h2>
        <p className="text-gray-600 text-sm mb-4">예산과 용도를 입력하면 AI가 최적의 PC 부품 조합을 추천해드립니다.</p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Link
            to="/ai-recommend"
            className="inline-flex items-center px-6 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium transition-colors"
          >
            AI 견적 추천 받기
          </Link>
          <Link
            to="/pc-builder"
            className="inline-flex items-center px-6 py-2.5 rounded-lg bg-white text-blue-600 border border-blue-300 hover:bg-blue-50 font-medium transition-colors"
          >
            직접 견적 짜기
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 justify-center text-sm">
        <Link to="/category/cpu" className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">CPU 가격비교</Link>
        <Link to="/category/gpu" className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">GPU 가격비교</Link>
        <Link to="/category/memory" className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">메모리 가격비교</Link>
        <Link to="/category/storage" className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">SSD 가격비교</Link>
        <Link to="/category/motherboard" className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">메인보드 가격비교</Link>
      </div>
    </div>
  );
}

function ArticleCard({ article }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <button
        className="w-full text-left px-6 py-5 hover:bg-gray-50 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">{article.title}</h2>
            <p className="text-sm text-gray-500">{article.summary}</p>
          </div>
          <span className="text-gray-400 shrink-0 text-xl mt-0.5">{open ? "−" : "+"}</span>
        </div>
      </button>
      {open && (
        <div className="px-6 pb-6 pt-2 border-t border-gray-100">
          {article.render()}
        </div>
      )}
    </div>
  );
}
