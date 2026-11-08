import { seoulToday } from "@/lib/time";
import type { SourceAdapter } from "./types";
import { MockAdapter } from "./mock-adapter";
import { BizinfoAdapter } from "./bizinfo";
import { KstartupAdapter } from "./kstartup";

/** 키 등 설정이 갖춰진 어댑터만 반환. 설정이 없으면 undefined(실호출하지 않음). */
export function getAdapter(sourceId: string): SourceAdapter | undefined {
  if (sourceId === "mock") return new MockAdapter(seoulToday());
  if (sourceId === "bizinfo" && process.env.BIZINFO_API_KEY) return new BizinfoAdapter(process.env.BIZINFO_API_KEY);
  if (sourceId === "k-startup" && process.env.DATA_GO_KR_API_KEY) return new KstartupAdapter(process.env.DATA_GO_KR_API_KEY);
  return undefined;
}
export function configuredAdapters(): SourceAdapter[] {
  return ["mock", "bizinfo", "k-startup"].map(getAdapter).filter((a): a is SourceAdapter => !!a);
}
