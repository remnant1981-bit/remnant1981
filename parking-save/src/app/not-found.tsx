import Link from "next/link";
import { getLang } from "@/i18n/server";
import { dict } from "@/i18n/dict";

export default async function NotFound() {
  const t = dict(await getLang());
  return (<><h1 className="text-xl font-bold">{t.misc.notFound}</h1><p className="mt-2"><Link href="/" className="underline">{t.search.home}</Link></p></>);
}
