import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

export default [
  { ignores: [".next/**", "node_modules/**", "data/**", "next-env.d.ts", "playwright-report/**", "test-results/**"] },
  ...coreWebVitals,
  ...typescript,
  // API 응답 JSON 등 동적 형태를 다루는 클라이언트/테스트 코드에서 any 허용
  { rules: { "@typescript-eslint/no-explicit-any": "off" } },
];
