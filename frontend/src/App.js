import { Suspense, lazy } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import Header from "./components/Header";
import Footer from "./components/Footer";
import CompareBar from "./components/CompareBar";
import ErrorBoundary from "./components/ErrorBoundary";
import { CompareProvider } from "./context/CompareContext";

const Home = lazy(() => import("./pages/Home"));
const Category = lazy(() => import("./pages/Category"));
const PartDetail = lazy(() => import("./pages/PartDetail"));
const Recommend = lazy(() => import("./pages/Recommend"));
const Search = lazy(() => import("./pages/Search"));
const Compare = lazy(() => import("./pages/Compare"));
const Favorites = lazy(() => import("./pages/Favorites"));
const Privacy = lazy(() => import("./pages/Privacy"));
const About = lazy(() => import("./pages/About"));
const Guide = lazy(() => import("./pages/Guide"));
const Terms = lazy(() => import("./pages/Terms"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function App() {
  return (
    <CompareProvider>
      <Router>
        <div className="min-h-screen flex flex-col relative overflow-hidden bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
          <div className="fixed inset-0 pointer-events-none">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-900/10 via-purple-900/15 to-pink-900/10" />
          </div>

          <Header />
          <main className="flex-1 relative z-10">
            <ErrorBoundary>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/category/:category" element={<Category />} />
                  <Route path="/detail/:category/:slug" element={<PartDetail />} />
                  <Route path="/ai-recommend" element={<Recommend />} />
                  <Route path="/search" element={<Search />} />
                  <Route path="/compare" element={<Compare />} />
                  <Route path="/favorites" element={<Favorites />} />
                  <Route path="/recommended" element={<Navigate to="/ai-recommend" replace />} />
                  <Route path="/cpu" element={<Navigate to="/category/cpu" replace />} />
                  <Route path="/gpu" element={<Navigate to="/category/gpu" replace />} />
                  <Route path="/motherboard" element={<Navigate to="/category/motherboard" replace />} />
                  <Route path="/ram" element={<Navigate to="/category/memory" replace />} />
                  <Route path="/privacy" element={<Privacy />} />
                  <Route path="/terms" element={<Terms />} />
                  <Route path="/about" element={<About />} />
                  <Route path="/guide" element={<Guide />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </main>
          <CompareBar />
          <Footer />
        </div>
      </Router>
    </CompareProvider>
  );
}
