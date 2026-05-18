const CONDITIONS = [
  {
    key: "used",
    label: "중고",
    regex: /중고/,
    className: "bg-amber-100 text-amber-700 border-amber-200",
  },
  {
    key: "refer",
    label: "리퍼",
    regex: /리퍼/,
    className: "bg-purple-100 text-purple-700 border-purple-200",
  },
  {
    key: "parallel",
    label: "병행수입",
    regex: /병행수입/,
    className: "bg-yellow-100 text-yellow-700 border-yellow-200",
  },
  {
    key: "multipack",
    label: "멀티팩",
    regex: /멀티팩/,
    className: "bg-blue-100 text-blue-700 border-blue-200",
  },
];

export function detectConditions(name = "") {
  return CONDITIONS.filter((c) => c.regex.test(name));
}

export { CONDITIONS };
