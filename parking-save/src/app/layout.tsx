import type { Metadata, Viewport } from "next";
import "./globals.css";
import { MockBanner } from "@/components/MockBanner";
import { mockEnabled } from "@/server/mock";
import { PwaRegister } from "@/components/PwaRegister";
import { LangSwitch } from "@/components/LangSwitch";
import Link from "next/link";
import { getLang } from "@/i18n/server";
import { dict } from "@/i18n/dict";
import { siteUrl } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLang();
  const t = dict(lang).layout;
  const name = t.title.split(" - ")[0];
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: t.title, template: `%s | ${name}` },
    description: t.desc,
    openGraph: { type: "website", siteName: name, title: t.title, description: t.desc, locale: lang === "en" ? "en_US" : "ko_KR" },
    twitter: { card: "summary_large_image" },
    icons: { icon: "/icons/icon.svg", apple: "/icons/apple-touch-icon.png" },
    appleWebApp: { capable: true, title: name, statusBarStyle: "default" },
  };
}
export const viewport: Viewport = { themeColor: "#1d4ed8" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  const t = dict(lang);
  return (
    <html lang={lang}>
      <body>
        <a href="#main" className="skip-link">{t.layout.skip}</a>
        {mockEnabled() && <MockBanner lang={lang} />}
        <PwaRegister />
        <div className="mx-auto flex max-w-2xl justify-end px-4 pt-3"><LangSwitch to={t.layout.langSwitchLang} label={t.layout.langSwitch} aria={t.layout.langLabel} /></div>
        <main id="main" className="mx-auto max-w-2xl px-4 pb-8 pt-3">{children}</main>
        <footer className="mx-auto max-w-2xl px-4 pb-8 text-xs text-gray-600">
          <nav aria-label={t.layout.footerNav} className="flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/terms" className="underline">{t.layout.terms}</Link>
            <Link href="/privacy" className="underline">{t.layout.privacy}</Link>
          </nav>
          <p className="mt-1">{t.layout.footerNote}</p>
        </footer>
      </body>
    </html>
  );
}
