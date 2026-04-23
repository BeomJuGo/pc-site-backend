import { createContext, useContext, useState, useEffect } from "react";

const CompareContext = createContext(null);

const STORAGE_KEY = "compare_parts";
const MAX_ITEMS = 3;

export function CompareProvider({ children }) {
  const [items, setItems] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch { return []; }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const add = (part) => {
    setItems((prev) => {
      if (prev.length >= MAX_ITEMS) return prev;
      if (prev.some((p) => p.name === part.name && p.category === part.category)) return prev;
      return [...prev, { name: part.name, category: part.category, price: part.price, image: part.image }];
    });
  };

  const remove = (name) => setItems((prev) => prev.filter((p) => p.name !== name));
  const clear = () => setItems([]);
  const has = (name) => items.some((p) => p.name === name);

  return (
    <CompareContext.Provider value={{ items, add, remove, clear, has, max: MAX_ITEMS }}>
      {children}
    </CompareContext.Provider>
  );
}

export function useCompare() {
  const ctx = useContext(CompareContext);
  if (!ctx) throw new Error("useCompare must be used within CompareProvider");
  return ctx;
}
