"use client";
import { toggleFavorite, useFavorites } from "@/lib/saved";

/**
 * 즐겨찾기 토글(이 기기에만 저장). 상태는 aria-pressed로 전달하고, 접근 가능한 이름은
 * 보이는 글자("즐겨찾기")로 시작하게 해 음성 명령·화면낭독기에서 같은 이름으로 찾을 수 있게 한다.
 */
export function FavoriteButton({ id, name, address }: { id: number; name: string; address: string | null }) {
  const favs = useFavorites();
  const on = favs.some((f) => f.id === id);
  return (
    <button type="button" aria-pressed={on} onClick={() => toggleFavorite({ id, name, address })}
      className={`shrink-0 rounded border px-2 py-1 text-xs ${on ? "border-amber-600 bg-amber-50 text-amber-900" : "border-gray-400 text-gray-700"}`}>
      <span aria-hidden="true">{on ? "★ " : "☆ "}</span>즐겨찾기<span className="sr-only"> {name}</span>
    </button>
  );
}
