import type { RawAnnouncement } from "@/domain/announcements";

/** 원천별 어댑터. 정규화·검증·중복판정·저장·보고는 runner 가 공통 수행. */
export interface SourceAdapter {
  readonly sourceId: string;
  fetch(): Promise<RawAnnouncement[]>;
}
