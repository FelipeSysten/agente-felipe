"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-renderiza a página (dados do servidor) a cada `seconds`, só com a aba visível. */
export function AutoRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
