// 지도 배경(타일) 제공자 설정. 운영 환경변수로 고르며 다시 빌드할 필요가 없다(서버가 읽어 화면에 전달).
//   MAP_TILE_PROVIDER = osm(기본) | vworld
//   VWORLD_API_KEY    = 브이월드(국토교통부 공간정보 오픈플랫폼) 인증키 — 무료, 발급 시 서비스 도메인을 등록하는 브라우저용 키라 화면에 노출돼도 되는 값
// OSM 공식 타일은 대량 사용 금지 정책이 있어(OPEN_ISSUES) 트래픽이 늘면 브이월드로 바꾼다.
// 다른 제공자를 추가하려면 여기 항목과 next.config.ts의 CSP img-src(TILE_HOSTS)를 함께 고친다.
// 네이버 지도는 타일 단독 사용이 아니라 자체 JS SDK를 써야 해서 이 구조(Leaflet 타일)로는 붙일 수 없음 — 별도 지도 컴포넌트 필요.

export type TileProviderId = "osm" | "vworld";
export interface TileConfig { id: TileProviderId; url: string; attribution: string; maxZoom: number }

/** CSP img-src에 허용할 타일 호스트(빌드 시 고정) */
export const TILE_HOSTS = ["https://tile.openstreetmap.org", "https://api.vworld.kr"] as const;

const OSM: TileConfig = {
  id: "osm", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
};

/**
 * 환경변수로 타일 설정을 고른다. 브이월드를 골랐는데 키가 없거나 형식이 이상하면 OSM으로 되돌리고 이유를 돌려준다(지도가 빈 화면이 되지 않게).
 * 브이월드 URL 형식은 공개 자료 기준(`/req/wmts/1.0.0/{키}/Base/{z}/{y}/{x}.png` — 행·열 순서가 OSM과 반대) — 실제 키로는 아직 미검증.
 */
export function tileConfig(env: Record<string, string | undefined> = process.env): { tile: TileConfig; warning: string | null } {
  const want = (env.MAP_TILE_PROVIDER ?? "osm").trim().toLowerCase();
  if (want === "" || want === "osm") return { tile: OSM, warning: null };
  if (want === "vworld") {
    const key = (env.VWORLD_API_KEY ?? "").trim();
    if (!/^[A-Za-z0-9-]{8,64}$/.test(key)) return { tile: OSM, warning: "MAP_TILE_PROVIDER=vworld인데 VWORLD_API_KEY가 없거나 형식이 올바르지 않아 OSM 타일을 사용합니다." };
    return { tile: { id: "vworld", url: `https://api.vworld.kr/req/wmts/1.0.0/${key}/Base/{z}/{y}/{x}.png`, maxZoom: 19,
      attribution: '&copy; <a href="https://www.vworld.kr" target="_blank" rel="noopener noreferrer">VWorld</a>(국토교통부)' }, warning: null };
  }
  return { tile: OSM, warning: `알 수 없는 MAP_TILE_PROVIDER(${want.slice(0, 20)}) — OSM 타일을 사용합니다.` };
}
