import { useNavigate } from "react-router-dom";
import { useFavorites } from "../hooks/useFavorites";
import PartCard from "../components/PartCard";

export default function Favorites() {
  const { favorites, remove, clearAll } = useFavorites();
  const navigate = useNavigate();

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">즐겨찾기</h1>
        {favorites.length > 0 && (
          <button
            onClick={clearAll}
            className="px-4 py-2 text-sm text-gray-500 hover:text-red-500 rounded-lg hover:bg-gray-100 transition-colors"
          >
            전체 삭제
          </button>
        )}
      </div>

      {favorites.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-5xl mb-4">🤍</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">저장된 즐겨찾기가 없습니다</h2>
          <p className="text-gray-500 mb-6">부품 카드에 마우스를 올려 하트 버튼을 클릭하세요.</p>
          <button
            onClick={() => navigate("/category/cpu")}
            className="px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-all"
          >
            부품 보러가기
          </button>
        </div>
      ) : (
        <>
          <p className="text-gray-500 text-sm mb-4">{favorites.length}개 저장됨</p>
          <div className="space-y-3">
            {favorites.map((part) => (
              <div key={`${part.category}-${part.name}`} className="relative border border-gray-200 rounded-xl bg-white shadow-sm overflow-hidden">
                <PartCard
                  part={part}
                  onClick={() => navigate(`/detail/${part.category}/${encodeURIComponent(part.name)}`)}
                />
                <button
                  onClick={() => remove(part.name, part.category)}
                  className="absolute top-3 left-3 p-1.5 bg-red-500 hover:bg-red-600 text-white rounded-md transition-colors text-xs"
                  title="즐겨찾기 삭제"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
