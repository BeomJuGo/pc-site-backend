import { Link } from "react-router-dom";

export default function Terms() {
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-12 max-w-3xl mx-auto">
      <div className="bg-white/90 backdrop-blur-sm border border-slate-200/50 rounded-2xl p-8 shadow-xl">
        <h1 className="text-3xl font-bold text-slate-800 mb-2">이용약관</h1>
        <p className="text-sm text-slate-500 mb-8">최종 업데이트: {new Date().toLocaleDateString("ko-KR")}</p>

        <section className="space-y-6 text-slate-700 leading-relaxed">
          <div>
            <h2 className="text-lg font-semibold text-slate-800 mb-2">제1조 (목적)</h2>
            <p>
              본 약관은 GoodPricePC(이하 &quot;사이트&quot;)가 제공하는 PC 부품 비교·AI 견적 추천 등 서비스(이하 &quot;서비스&quot;)의 이용 조건 및 절차,
              이용자와 사이트 간의 권리·의무 관계를 규정함을 목적으로 합니다.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-slate-800 mb-2">제2조 (서비스 내용)</h2>
            <p>
              사이트는 PC 부품(CPU, GPU, 메모리, 메인보드, 저장장치, 케이스, 쿨러, 파워서플라이)의 가격·성능(벤치마크) 정보 제공,
              카테고리별 비교·정렬·필터, 부품 상세 정보 및 가격 추이, AI 기반 견적 추천 등의 서비스를 제공합니다.
              제공되는 가격·성능 데이터는 수집 시점 및 출처에 따라 변동·오차가 있을 수 있습니다.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-slate-800 mb-2">제3조 (이용자의 의무)</h2>
            <p>
              이용자는 서비스를 법령 및 본 약관에 맞게 이용해야 하며, 서비스의 정상적 운영을 방해하거나
              타인의 정보를 부정하게 이용하는 행위를 해서는 안 됩니다.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-slate-800 mb-2">제4조 (저작권 및 데이터)</h2>
            <p>
              사이트에 게재된 텍스트·이미지·디자인 등에 대한 저작권은 사이트 또는 권리자에게 있습니다.
              부품 가격·벤치마크 등 데이터는 외부 출처(쇼핑몰, PassMark, 3DMark, Cinebench 등)를 참고·정리한 것이며,
              실제 구매·성능 확인 시 해당 판매처 및 벤치마크 제공처 정보를 참고하시기 바랍니다.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-slate-800 mb-2">제5조 (면책)</h2>
            <p>
              사이트는 서비스에서 제공하는 정보의 정확성·완전성·적시성을 보장하지 않습니다.
              이용자가 서비스 정보를 바탕으로 한 구매·조립·투자 등 결정에 따른 결과에 대해 사이트는 책임을 지지 않습니다.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-slate-800 mb-2">제6조 (약관 변경)</h2>
            <p>
              사이트는 필요한 경우 약관을 변경할 수 있으며, 변경 시 사이트 내 공지 또는 적절한 방법으로 안내합니다.
              변경 후에도 서비스를 계속 이용하면 변경된 약관에 동의한 것으로 봅니다.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-slate-800 mb-2">제7조 (문의)</h2>
            <p>
              이용약관 및 서비스에 대한 문의는 사이트 소개(About) 페이지의 연락처 또는 개인정보처리방침에 안내된 경로를 이용해 주시기 바랍니다.
            </p>
          </div>
        </section>

        <div className="mt-10 pt-6 border-t border-slate-200 flex flex-wrap gap-4">
          <Link to="/" className="text-blue-600 hover:text-blue-700 font-medium">홈으로</Link>
          <Link to="/about" className="text-blue-600 hover:text-blue-700 font-medium">사이트 소개</Link>
          <Link to="/privacy" className="text-blue-600 hover:text-blue-700 font-medium">개인정보처리방침</Link>
        </div>
      </div>
    </div>
  );
}
