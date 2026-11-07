import { CATEGORIES } from "@/domain/taxonomy";
import type { Db } from "./db";

// 조사 대상 원천(DATA_COLLECTION.md §2). 실제 API/약관/쿼터 확인 전이므로 모두 미연동·비활성.
export const SOURCES = [
  { id: "bizinfo", name: "기업마당", type: "api", status: "not_integrated" },
  { id: "mss", name: "중소벤처기업부 공고/API", type: "api", status: "not_integrated" },
  { id: "k-startup", name: "K-Startup", type: "api", status: "not_integrated" },
  { id: "msit", name: "과학기술정보통신부 공고", type: "web", status: "not_integrated" },
  { id: "iris", name: "IRIS 국가연구개발사업", type: "web", status: "not_integrated" },
  { id: "smes24", name: "중소벤처24", type: "web", status: "not_integrated" },
  { id: "pannda", name: "판판대로", type: "web", status: "not_integrated" },
  { id: "gyeonggi", name: "경기도·경기테크노파크", type: "web", status: "not_integrated" },
  { id: "siheung", name: "시흥시·시흥산업진흥원", type: "web", status: "not_integrated" },
];

export async function seedReference(db: Db) {
  for (const [i, c] of CATEGORIES.entries()) {
    await db.run("INSERT OR IGNORE INTO categories(id, name, sort_order) VALUES (?,?,?)", [c.id, c.name, i]);
  }
  for (const s of SOURCES) {
    await db.run(
      "INSERT OR IGNORE INTO data_sources(id, name, source_type, enabled, integration_status, quota_note) VALUES (?,?,?,0,?,?)",
      [s.id, s.name, s.type, s.status, "API 이용조건·쿼터·약관·재배포 범위 확인 전(OPEN_ISSUES #1). 미연동."],
    );
  }
  await db.run(
    "INSERT OR IGNORE INTO data_sources(id, name, source_type, enabled, integration_status, quota_note, collection_frequency) VALUES ('mock','테스트(모의) 데이터','mock',1,'mock','개발·테스트용 모의 데이터. 실제 공고 아님.','manual')");
  await db.run(
    "INSERT OR IGNORE INTO data_sources(id, name, source_type, enabled, integration_status, quota_note) VALUES ('manual','관리자 수동 등록','manual',1,'manual','관리자가 직접 입력한 공고')");
}
