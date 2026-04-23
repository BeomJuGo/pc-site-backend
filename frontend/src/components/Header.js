import { Link, NavLink } from "react-router-dom";

export default function Header() {
  const link =
    "px-3 py-2 text-sm text-slate-600 hover:text-slate-900 hover:underline underline-offset-4";
  return (
    <header className="bg-white border-b border-slate-200">
      <div className="px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <Link to="/" className="text-[18px] font-bold text-slate-900">
          GoodPricePC
        </Link>
        <nav className="flex items-center gap-1">
          <NavLink to="/category/cpu" className={link}>CPU</NavLink>
          <NavLink to="/category/gpu" className={link}>GPU</NavLink>
          <NavLink to="/category/motherboard" className={link}>메인보드</NavLink>
          <NavLink to="/category/memory" className={link}>메모리</NavLink>
          <NavLink to="/ai-recommend" className="ml-1 px-3 py-2 text-sm rounded-lg bg-slate-900 text-white">
            AI 추천
          </NavLink>
        </nav>
      </div>
    </header>
  );
}
