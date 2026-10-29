import type { Ref } from "react";
import { Link } from "react-router";

import { Button } from "../../../ui/Button";
import { useMe } from "../../me/useMe";
import {
  PREFLIGHT_INTRO,
  PREFLIGHT_SAFE,
  PREFLIGHT_TITLE,
  PREFLIGHT_TIME,
  PROFILE_LINK,
  preflightUnit,
  preflightZone,
  preflightZoneDiffers,
  START,
} from "./messages";
import { StaleRecordsBanner } from "./StaleRecordsBanner";
import styles from "./ImportScreen.module.css";

/** The device zone (D10: Hevy stores none, so the device decides). */
export const deviceZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Spec 20.1 AC2, §5.1: what the import does, said before anything is read. Text, not a form. */
export function PreflightStep({ onStart, headingRef }: { onStart: () => void; headingRef: Ref<HTMLHeadingElement> }) {
  const me = useMe().data;
  const zone = deviceZone();
  return (
    <section className={styles.step} aria-labelledby="hevy-import-step">
      <StaleRecordsBanner />
      <h2 className={styles.stepTitle} id="hevy-import-step" ref={headingRef} tabIndex={-1}>
        {PREFLIGHT_TITLE}
      </h2>
      <p className={styles.text}>{PREFLIGHT_INTRO}</p>
      <ul className={styles.list}>
        <li>{PREFLIGHT_TIME}</li>
        <li>
          {preflightZone(zone)}
          {me && me.timezone !== zone ? (
            <>
              {" "}
              {preflightZoneDiffers(me.timezone)}{" "}
              <Link className={styles.link} to="/app/profile">
                {PROFILE_LINK}
              </Link>
            </>
          ) : null}
        </li>
        {me ? <li>{preflightUnit(me.unitPreference)}</li> : null}
        <li>{PREFLIGHT_SAFE}</li>
      </ul>
      <div className={styles.actions}>
        <Button onClick={onStart}>{START}</Button>
      </div>
    </section>
  );
}
