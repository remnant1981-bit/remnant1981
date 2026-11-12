"use client";
import { toggleFavorite, useFavorites } from "@/lib/saved";

/** 즐겨찾기 토글(이 기기에만 저장) */
export function FavoriteButton({ id, name, address }: { id: number; name: string; address: string | null }) {
  const favs = useFavorites();
  const on = favs.some((f) => f.id === id);
  return (
    <button type="button" aria-pressed={on} onClick={() => toggleFavorite({ id, name, address })}
      className={`shrink-0 rounded border px-2 py-1 text-xs ${on ? "border-amber-600 bg-amber-50 text-amber-900" : "border-gray-400 text-gray-700"}`}
      aria-label={on ? `${name} 즐겨찾기 해제` : `${name} 즐겨찾기에 추가`}>
      <span aria-hidden="true">{on ? "★" : "☆"}</span> {on ? "즐겨찾기됨" : "즐겨찾기"}
    </button>
  );
}
