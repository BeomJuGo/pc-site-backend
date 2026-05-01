import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
        <div className="text-6xl mb-6">⚠️</div>
        <h2 className="text-2xl font-bold text-gray-900 mb-3">페이지를 불러오지 못했습니다</h2>
        <p className="text-gray-500 mb-6 max-w-sm">
          {this.state.error?.message || "알 수 없는 오류가 발생했습니다."}
        </p>
        <button
          onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
          className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-all"
        >
          새로고침
        </button>
      </div>
    );
  }
}
