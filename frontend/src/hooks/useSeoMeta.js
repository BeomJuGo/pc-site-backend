import { useEffect } from "react";

export function useSeoMeta({ title, description, path } = {}) {
  useEffect(() => {
    if (title) document.title = title;
    if (description) {
      const tag = document.querySelector('meta[name="description"]');
      if (tag) tag.setAttribute("content", description);
    }
    if (path !== undefined) {
      const canonical = `https://www.gsb-pc.com${path}`;
      let link = document.querySelector('link[rel="canonical"]');
      if (!link) {
        link = document.createElement("link");
        link.setAttribute("rel", "canonical");
        document.head.appendChild(link);
      }
      link.setAttribute("href", canonical);
    }
  }, [title, description, path]);
}
