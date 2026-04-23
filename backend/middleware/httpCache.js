export function setCacheHeaders(maxAge = 60) {
  return (req, res, next) => {
    res.set("Cache-Control", `public, max-age=${maxAge}`);
    next();
  };
}
