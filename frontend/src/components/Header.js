import { Link, NavLink, useNavigate } from "react-router-dom";
import { useState, useEffect, useRef, useCallback } from "react";

const CATEGORY_ITEMS = [
  { to: "/category/cpu", label: "CPU" },
  { to: "/category/gpu", label: "GPU" },
  { to: "/category/motherboard", label: "메인보드" },
  { to: "/category/memory", label: "메모리" },
  { to: "/category/storage", label: "저장장치" },
  { to: "/category/case", label: "케이스" },
  { to: "/category/cooler", label: "쿨러" },
  { to: "/category/psu", label: "파워" },
];

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const menuRef = useRef(null);
  const searchInputRef = useRef(null);
  const debounceRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => { setIsLoaded(true); }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsMenuOpen(false);
      }
    };
    if (isMenuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isMenuOpen]);

  useEffect(() => {
    if (isSearchOpen) setTimeout(() => searchInputRef.current?.focus(), 50);
  }, [isSearchOpen]);

  const handleSearchChange = useCallback((e) => {
    const q = e.target.value;
    setSearchQuery(q);
    clearTimeout(debounceRef.current);
    if (q.trim().length >= 2) {
      debounceRef.current = setTimeout(() => {
        navigate(`/search?q=${encodeURIComponent(q.trim())}`);
      }, 400);
    }
  }, [navigate]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      clearTimeout(debounceRef.current);
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setIsSearchOpen(false);
      setSearchQuery("");
    }
  };

  const closeMenu = () => setIsMenuOpen(false);

  return (
    <header ref={menuRef} className="relative bg-white/95 backdrop-blur-md border-b border-gray-200 shadow-sm sticky top-0 z-50">
      <div className="px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        <Link
          to="/"
          className={`text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent hover:scale-105 transition-all duration-500 flex-shrink-0 ${isLoaded ? "animate-fade-in-left" : "opacity-0"}`}
        >
          GoodPricePC
        </Link>

        <nav className="hidden md:flex items-center gap-1 flex-1">
          {CATEGORY_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `px-3 py-1.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                  isActive
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
          <NavLink
            to="/guide"
            className={({ isActive }) =>
              `px-3 py-1.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                isActive ? "bg-gray-200 text-gray-900" : "text-gray-600 hover:bg-gray-100"
              }`
            }
          >
            📖 가이드
          </NavLink>
        </nav>

        <div className={`flex items-center gap-2 flex-shrink-0 ${isLoaded ? "animate-fade-in-right" : "opacity-0"}`}>
          <button
            onClick={() => setIsSearchOpen((v) => !v)}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
            aria-label="검색"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
          </button>

          <Link to="/favorites" className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors" aria-label="즐겨찾기">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </Link>

          <NavLink
            to="/pc-builder"
            className="hidden md:inline-flex items-center px-3 py-2 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all border border-gray-200"
          >
            🛠️ 견적
          </NavLink>
          <NavLink
            to="/ai-recommend"
            className="hidden md:inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-sm"
          >
            ✨ AI 추천
          </NavLink>

          <button
            className="md:hidden p-2 rounded-lg hover:bg-gray-100 transition-all duration-300"
            onClick={() => setIsMenuOpen((v) => !v)}
            aria-label="메뉴"
          >
            <div className="w-6 h-6 flex flex-col justify-center space-y-1">
              <div className={`h-0.5 bg-gray-600 transition-all duration-300 ${isMenuOpen ? "rotate-45 translate-y-1.5" : ""}`} />
              <div className={`h-0.5 bg-gray-600 transition-all duration-300 ${isMenuOpen ? "opacity-0" : ""}`} />
              <div className={`h-0.5 bg-gray-600 transition-all duration-300 ${isMenuOpen ? "-rotate-45 -translate-y-1.5" : ""}`} />
            </div>
          </button>
        </div>
      </div>

      <div
        className={`overflow-hidden transition-all duration-300 ${
          isSearchOpen ? "max-h-20 opacity-100" : "max-h-0 opacity-0"
        } border-t border-gray-200 bg-gray-50`}
      >
        <form onSubmit={handleSearchSubmit} className="px-4 sm:px-6 lg:px-8 py-3 flex gap-2">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="부품 이름으로 검색... (예: RTX 4070, Ryzen 7)"
            className="flex-1 px-4 py-2 text-sm rounded-lg border border-gray-300 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all">
            검색
          </button>
          <button
            type="button"
            onClick={() => { setIsSearchOpen(false); setSearchQuery(""); }}
            className="px-3 py-2 text-sm text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-100 transition-colors"
          >
            닫기
          </button>
        </form>
      </div>

      <div
        className={`md:hidden absolute top-full left-0 right-0 bg-white border-b border-gray-200 shadow-lg transition-all duration-300 ${
          isMenuOpen ? "opacity-100 visible" : "opacity-0 invisible"
        }`}
      >
        <nav className="px-4 py-5">
          <div className="grid grid-cols-2 gap-2 mb-4">
            {CATEGORY_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `px-4 py-3 text-sm font-medium rounded-lg transition-all duration-200 text-center ${
                    isActive
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-gray-700 hover:text-gray-900 hover:bg-gray-100"
                  }`
                }
                onClick={closeMenu}
              >
                {item.label}
              </NavLink>
            ))}
          </div>
          <div className="border-t border-gray-200 pt-3 flex flex-wrap gap-2">
            <NavLink to="/guide" className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors" onClick={closeMenu}>
              📖 가이드
            </NavLink>
            <NavLink to="/pc-builder" className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all border border-gray-200" onClick={closeMenu}>
              🛠️ 직접 견적 짜기
            </NavLink>
            <NavLink to="/ai-recommend" className="px-5 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-sm" onClick={closeMenu}>
              ✨ AI 추천 받기
            </NavLink>
          </div>
        </nav>
      </div>
    </header>
  );
}
