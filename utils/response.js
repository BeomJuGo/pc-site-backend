// utils/response.js - API 응답 형식 표준화

/**
 * 성공 응답 생성
 * @param {any} data - 응답 데이터
 * @param {string} message - 성공 메시지
 * @returns {object} 표준화된 성공 응답
 */
export const successResponse = (data, message = "성공") => ({
  success: true,
  message,
  data,
  timestamp: new Date().toISOString()
});

/**
 * 에러 응답 생성
 * @param {string} error - 에러 코드
 * @param {string} message - 에러 메시지
 * @param {number} statusCode - HTTP 상태 코드
 * @param {any} details - 추가 상세 정보
 * @returns {object} 표준화된 에러 응답
 */
export const errorResponse = (error, message, statusCode = 500, details = null) => {
  const response = {
    success: false,
    error,
    message,
    timestamp: new Date().toISOString()
  };

  // 개발 환경에서만 상세 정보 추가
  if (process.env.NODE_ENV !== 'production' && details) {
    response.details = details;
  }

  return response;
};

/**
 * 페이지네이션 응답 생성
 * @param {any} data - 응답 데이터
 * @param {number} page - 현재 페이지
 * @param {number} limit - 페이지당 항목 수
 * @param {number} total - 전체 항목 수
 * @param {string} message - 성공 메시지
 * @returns {object} 페이지네이션 포함 응답
 */
export const paginatedResponse = (data, page, limit, total, message = "성공") => ({
  success: true,
  message,
  data,
  pagination: {
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    total,
    totalPages: Math.ceil(total / limit),
    hasNext: page * limit < total,
    hasPrev: page > 1
  },
  timestamp: new Date().toISOString()
});

