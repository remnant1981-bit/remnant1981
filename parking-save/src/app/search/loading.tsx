import { getLang } from "@/i18n/server";

export default async function Loading() {
  const lang = await getLang();
  return <p role="status" aria-live="polite">{lang === "en" ? "Loading…" : "불러오는 중…"}</p>;
}
