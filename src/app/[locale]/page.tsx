import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/language-switcher";

export default function Home() {
  const t = useTranslations("HomePage");

  return (
    <main>
      <LanguageSwitcher />
      <h1>{t("title")}</h1>
      <p>{t("description")}</p>
    </main>
  );
}
