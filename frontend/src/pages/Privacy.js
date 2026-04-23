import { Link } from "react-router-dom";

export default function Privacy() {
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-12 max-w-3xl mx-auto">
      <div className="bg-white/90 backdrop-blur-sm border border-slate-200/50 rounded-2xl p-8 shadow-xl">
        <h1 className="text-3xl font-bold text-slate-800 mb-2">개인정보처리방침</h1>
        <p className="text-sm text-slate-500 mb-8">최종 업데이트: {new Date().toLocaleDateString("ko-KR")}</p>

        <section className="space-y-6 text-slate-700 leading-relaxed">
          <div>
            <h2 className="text-lg font-semibold text-slate-800 mb-2">1. 개요</h2>
            <p>
              GoodPricePC(이하 &quot;사이트&quot;)는 이용자의 개인정보를 소중히 하며, 「개인정보 보호법」 등 관련 법령을 준수합니다.
              본 방침은 사이트에서 수집하는 정보, 이용 목적, 보관 기간 및 이용자 권리에 대해 안내합니다.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-slate-800 mb-2">2. 수집하는 정보</h2>
            <p>사이트는 서비스 제공을 위해 다음과 같은 정보를 수집할 수 있습니다.</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>접속 로그(IP 주소, 접속 시각, 브라우저 정보 등)</li>
              <li>AI 추천 등 서비스 이용 과정에서 입력한 선택 조건(부품 카테고리, 예산 등)</li>
              <li>Google AdSense를 통한 광고 서비스 이용 시 관련 데이터(쿠키 등)</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-slate-800 mb-2">3. 이용 목적</h2>
            <p>수집된 정보는 서비스 개선, 통계 분석, 맞춤 추천, 광고 게재 및 법령에 따른 요청 대응에 사용됩니다.</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-slate-800 mb-2">4. 제3자 제공 및 광고</h2>
            <p>
              사이트에는 Google AdSense 등 제3자 광고가 포함될 수 있습니다. 이러한 서비스는 자체적인 개인정보처리방침과 쿠키 정책을 적용하며,
              Google의 정책은{" "}
              <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                Google 개인정보처리방침
              </a>
              에서 확인할 수 있습니다.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-slate-800 mb-2">5. 보관 기간</h2>
            <p>법령에서 정한 경우를 제외하고, 수집 목적 달성 후 지체 없이 파기하거나 익명화 처리합니다.</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-slate-800 mb-2">6. 이용자 권리</h2>
            <p>이용자는 개인정보 열람·정정·삭제·처리정지 요청 권리가 있으며, 문의는 아래 연락처 또는 사이트 소개 페이지를 통해 할 수 있습니다.</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-slate-800 mb-2">7. 변경 사항</h2>
            <p>개인정보처리방침은 법령·서비스 변경에 따라 수정될 수 있으며, 변경 시 사이트 내에 공지합니다.</p>
          </div>
        </section>

        <div className="mt-10 pt-6 border-t border-slate-200">
          <Link to="/" className="inline-flex items-center text-blue-600 hover:text-blue-700 font-medium">
            ← 홈으로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}
