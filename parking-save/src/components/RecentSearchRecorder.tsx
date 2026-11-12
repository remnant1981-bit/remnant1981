"use client";
import { useEffect } from "react";
import { recordSearch } from "@/lib/saved";

/** 성공한 검색 조건을 최근 검색에 기록(이 기기에만 저장). 화면에는 아무것도 그리지 않음 */
export function RecentSearchRecorder({ query, label, period }: { query: string; label: string; period: string }) {
  useEffect(() => { recordSearch({ query, label, period }); }, [query, label, period]);
  return null;
}
