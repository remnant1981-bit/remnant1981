import { describe, expect, it } from "vitest";
import { buildNaverLinks, inKoreaRange } from "@/domain/map-link";

const parse = (u: string) => { const x = new URL(u.replace(/^nmap:\/\//, "http://nmap/")); return { path: x.pathname, q: Object.fromEntries(x.searchParams) }; };

describe("네이버 지도 링크 (공식 문서 예제 형식)", () => {
  // 문서 예: 서울대학교 → 동원낙성대아파트 도보
  const lot = { lat: 37.464007, lng: 126.9522394, name: "서울대학교" };
  const dest = { lat: 37.4764356, lng: 126.9618302, name: "동원낙성대아파트" };
  const l = buildNaverLinks({ lot, destination: dest, appname: "com.example.myapp" });

  it("도보: 문서 예제와 동일한 파라미터", () => {
    expect(parse(l.walk!.scheme)).toEqual({ path: "/route/walk", q: {
      slat: "37.464007", slng: "126.9522394", sname: "서울대학교", dlat: "37.4764356", dlng: "126.9618302", dname: "동원낙성대아파트", appname: "com.example.myapp" } });
    expect(l.walk!.scheme).toContain("sname=%EC%84%9C%EC%9A%B8%EB%8C%80%ED%95%99%EA%B5%90"); // URL 인코딩
  });
  it("자동차: 목적지(주차장)만, 출발지는 현재 위치(slat 생략)", () => {
    const q = parse(l.car!.scheme);
    expect(q.path).toBe("/route/car");
    expect(q.q).toEqual({ dlat: "37.464007", dlng: "126.9522394", dname: "서울대학교", appname: "com.example.myapp" });
  });
  it("마커(place): lat/lng/name 필수 3종", () => {
    expect(parse(l.place!.scheme).q).toMatchObject({ lat: "37.464007", lng: "126.9522394", name: "서울대학교" });
  });
  it("Android Intent URL 형식(패키지 지정 → 미설치 시 Play 스토어)", () => {
    expect(l.car!.androidIntent.startsWith("intent://route/car?dlat=")).toBe(true);
    expect(l.car!.androidIntent.endsWith("#Intent;scheme=nmap;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;package=com.nhn.android.nmap;end")).toBe(true);
  });
  it("appname은 URL이어도 인코딩되어 파라미터를 깨뜨리지 않음", () => {
    const x = buildNaverLinks({ lot, appname: "https://example.com/a?b=1&c=2" });
    expect(parse(x.car!.scheme).q.appname).toBe("https://example.com/a?b=1&c=2");
    expect(x.car!.scheme.split("&").length).toBe(4); // dlat,dlng,dname,appname
  });
  it("이름의 특수문자·주입 문자열은 인코딩", () => {
    const x = buildNaverLinks({ lot: { lat: 37.5, lng: 127, name: "A&dlat=0#x" }, appname: "a" });
    expect(parse(x.car!.scheme).q.dname).toBe("A&dlat=0#x");
    expect(x.car!.scheme).not.toContain("&dlat=0");
  });
  it("목적지 없으면 도보 링크 없음, 좌표 범위 밖/ appname 없음이면 전부 없음", () => {
    expect(buildNaverLinks({ lot, appname: "a" }).walk).toBeNull();
    expect(buildNaverLinks({ lot, destination: { lat: 0, lng: 0 }, appname: "a" }).walk).toBeNull();
    expect(buildNaverLinks({ lot: { lat: 91, lng: 127 }, appname: "a" })).toEqual({ car: null, walk: null, place: null });
    expect(buildNaverLinks({ lot, appname: "" }).car).toBeNull();
  });
  it("문서의 좌표 허용 범위", () => {
    expect(inKoreaRange({ lat: 31.43, lng: 122.37 })).toBe(true);
    expect(inKoreaRange({ lat: 44.36, lng: 127 })).toBe(false);
    expect(inKoreaRange({ lat: 37, lng: 132.01 })).toBe(false);
    expect(inKoreaRange({ lat: NaN, lng: 127 })).toBe(false);
  });
});
