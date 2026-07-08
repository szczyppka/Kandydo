"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

export function LanguageSwitcher() {
  const t = useTranslations("LanguageSwitcher");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <select
      aria-label={t("pl") + " / " + t("en")}
      value={locale}
      onChange={(event) =>
        router.replace(pathname, { locale: event.target.value })
      }
    >
      {routing.locales.map((l) => (
        <option key={l} value={l}>
          {t(l)}
        </option>
      ))}
    </select>
  );
}
