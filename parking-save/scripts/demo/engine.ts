// 데모 페이지에 번들되는 순수 도메인 로직(앱과 동일 코드). 브라우저 전역 PS 로 노출된다.
export { calculateFee } from "../../src/domain/fee";
export { operatingForStay, operatingUsesAssumed } from "../../src/domain/operating";
export { distanceMeters, walkMinutesEstimate } from "../../src/domain/geo";
export { explainAll } from "../../src/domain/recommend";
export { buildNaverLinks } from "../../src/domain/map-link";
export { kstYmd, toKstLocalInput, formatKst } from "../../src/lib/time";
export { cheaperShifts } from "../../src/domain/cheaper";
export { feeAnomalies, discountTargets, FEE_ANOMALY_LABEL } from "../../src/domain/fee-check";
export { seasonPassHint } from "../../src/domain/season-pass";
