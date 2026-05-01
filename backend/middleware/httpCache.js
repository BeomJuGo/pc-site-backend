export function setCacheHeaders(maxAge = 60, swr = 0) {
  return (req, res, next) => {
    const directive = swr > 0
      ? `public, max-age=${maxAge}, stale-while-revalidate=${swr}`
      : `public, max-age=${maxAge}`;
    res.set("Cache-Control", directive);
    next();
  };
}
