import { useState, useEffect } from "react";

const STORAGE_KEY = "favorites";

export function useFavorites() {
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch { return []; }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
    } catch {
      // QuotaExceededError: storage full, keep in-memory state as-is
    }
  }, [favorites]);

  const add = (part) =>
    setFavorites((prev) => {
      if (prev.some((p) => p.name === part.name && p.category === part.category)) return prev;
      return [...prev, { name: part.name, category: part.category, price: part.price, image: part.image }];
    });

  const remove = (name, category) =>
    setFavorites((prev) => prev.filter((p) => !(p.name === name && p.category === category)));

  const toggle = (part) => {
    if (isFavorite(part.name, part.category)) remove(part.name, part.category);
    else add(part);
  };

  const isFavorite = (name, category) =>
    favorites.some((p) => p.name === name && p.category === category);

  const clearAll = () => setFavorites([]);

  return { favorites, add, remove, toggle, isFavorite, clearAll };
}
