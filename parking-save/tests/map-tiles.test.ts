// 지도 타일 제공자 설정(환경변수로 교체, 잘못된 설정은 OSM으로 되돌림)
import { describe, expect, it } from "vitest";
import { tileConfig, TILE_HOSTS } from "@/lib/map-tiles";

describe("지도 타일 설정", () => {
  it("기본은 OSM(출처 표기 포함)", () => {
    const { tile, warning } = tileConfig({});
    expect(tile).toMatchObject({ id: "osm", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maxZoom: 19 });
    expect(tile.attribution).toContain("OpenStreetMap");
    expect(warning).toBeNull();
  });
  it("브이월드: 키를 넣으면 행·열 순서({y}/{x})가 다른 WMTS 주소, 출처 표기", () => {
    const { tile, warning } = tileConfig({ MAP_TILE_PROVIDER: "vworld", VWORLD_API_KEY: "ABCD1234-EF56-7890-ABCD-1234567890AB" });
    expect(tile.url).toBe("https://api.vworld.kr/req/wmts/1.0.0/ABCD1234-EF56-7890-ABCD-1234567890AB/Base/{z}/{y}/{x}.png");
    expect(tile.attribution).toContain("VWorld");
    expect(warning).toBeNull();
  });
  it("키가 없거나 이상하면 OSM으로 되돌리고 경고(빈 지도 방지·주소 주입 방지)", () => {
    for (const key of [undefined, "", "abc", "x/../../evil", "<script>", "a".repeat(80)]) {
      const r = tileConfig({ MAP_TILE_PROVIDER: "vworld", VWORLD_API_KEY: key });
      expect(r.tile.id).toBe("osm");
      expect(r.warning).toMatch(/VWORLD_API_KEY/);
    }
    expect(tileConfig({ MAP_TILE_PROVIDER: "google" }).warning).toMatch(/알 수 없는/);
  });
  it("모든 제공자 타일 호스트가 CSP 허용 목록에 있음", () => {
    for (const env of [{}, { MAP_TILE_PROVIDER: "vworld", VWORLD_API_KEY: "ABCD1234EF56" }]) {
      const host = new URL(tileConfig(env).tile.url.replace(/[{}]/g, "")).origin;
      expect(TILE_HOSTS).toContain(host);
    }
  });
});
