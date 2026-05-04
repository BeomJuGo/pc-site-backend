import { useEffect } from "react";

export function useSeoMeta({ title, description } = {}) {
  useEffect(() => {
    if (title) document.title = title;
    if (description) {
      const tag = document.querySelector('meta[name="description"]');
      if (tag) tag.setAttribute("content", description);
    }
  }, [title, description]);
}
