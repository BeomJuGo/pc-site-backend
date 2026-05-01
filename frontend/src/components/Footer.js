import { Link } from "react-router-dom";

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-10 border-t border-gray-200 bg-gray-50">
      <div className="px-4 sm:px-6 lg:px-8 py-8 text-sm text-gray-500">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div className="flex items-center space-x-2">
            <span className="text-blue-600">💻</span>
            <span>벤치마크 기준: PassMark, 3DMark, Cinebench</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-indigo-600">ℹ️</span>
            <span>표시된 점수와 가격은 참고용이며 실제 제품과 차이가 있을 수 있습니다.</span>
          </div>
          <div className="sm:text-right flex items-center justify-end space-x-2">
            <span className="text-blue-600">📅</span>
            <span>© {year} GoodPricePC</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 justify-center sm:justify-start border-t border-gray-200 pt-4">
          <Link to="/about" className="text-gray-500 hover:text-gray-900 font-medium transition-colors">
            사이트 소개
          </Link>
          <Link to="/guide" className="text-gray-500 hover:text-gray-900 font-medium transition-colors">
            이용 가이드
          </Link>
          <Link to="/privacy" className="text-gray-500 hover:text-gray-900 font-medium transition-colors">
            개인정보처리방침
          </Link>
          <Link to="/terms" className="text-gray-500 hover:text-gray-900 font-medium transition-colors">
            이용약관
          </Link>
          <a href="mailto:lom0097@naver.com" className="text-gray-500 hover:text-gray-900 font-medium transition-colors">
            문의
          </a>
        </div>
      </div>
    </footer>
  );
}
