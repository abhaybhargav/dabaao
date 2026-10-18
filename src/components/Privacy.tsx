import { useT } from "../i18n";
import { SOURCE_URL } from "../config";

export function Privacy() {
  const { t } = useT();
  return (
    <section className="panel prose">
      <h2>{t("privacy.title")}</h2>
      <p>{t("privacy.p1")}</p>
      <p>{t("privacy.p2")}</p>
      <p>{t("privacy.p3")}</p>
      <p>{t("privacy.p4")}</p>
      <p>{t("privacy.p5")}</p>
      <p><a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">{t("footer.source")}</a></p>
    </section>
  );
}
