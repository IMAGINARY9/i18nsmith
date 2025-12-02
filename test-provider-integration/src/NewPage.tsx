import { useTranslation } from "./contexts/TranslationContext";
import React from "react";

export default function NewPage() {
  const { t } = useTranslation();
  return (
    <div>
      <h1>{t("common.newpage.hello-world.704d63")}</h1>
      <p>{t("common.newpage.this-is-a-test.ff41ee")}</p>
      <button>{t("common.newpage.click-me.2e2113")}</button>
    </div>
  );
}
