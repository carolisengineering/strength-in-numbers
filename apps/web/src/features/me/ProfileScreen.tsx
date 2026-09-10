import {
  UNIT_PREFERENCE_VALUES,
  type Me,
  type UnitPreference,
  type UpdateMeInput,
} from "@sin/core";
import { useMemo, useState, type FormEvent } from "react";

import { ApiError } from "../../api/problem";
import { useSession } from "../../auth/useSession";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Screen } from "../../ui/Screen";
import { Spinner } from "../../ui/Spinner";
import styles from "./ProfileScreen.module.css";
import { listTimeZones } from "./timeZones";
import { useMe } from "./useMe";
import { useUpdateMe } from "./useUpdateMe";

type FieldName = keyof UpdateMeInput;
const FIELD_NAMES: readonly FieldName[] = ["displayName", "unitPreference", "timezone"];
const isFieldName = (path: string): path is FieldName =>
  (FIELD_NAMES as readonly string[]).includes(path);

interface FormValues {
  displayName: string;
  unitPreference: UnitPreference;
  timezone: string;
}

const fromMe = (me: Me): FormValues => ({
  displayName: me.displayName ?? "",
  unitPreference: me.unitPreference,
  timezone: me.timezone,
});

/**
 * Only the fields that differ from the loaded row (Spec 04.1 §6.5, AC6). An
 * empty (or whitespace-only) display name is an explicit clear → `null`.
 */
function diff(current: Me, values: FormValues): UpdateMeInput {
  const body: UpdateMeInput = {};
  const name = values.displayName.trim();
  if (name !== (current.displayName ?? "")) body.displayName = name === "" ? null : name;
  if (values.unitPreference !== current.unitPreference)
    body.unitPreference = values.unitPreference;
  if (values.timezone !== current.timezone) body.timezone = values.timezone;
  return body;
}

/**
 * The Profile vertical slice (Spec 04.1 §5, AC5–AC7): load from `useMe`,
 * edit, `PATCH` only the dirty fields, write the cache. `422` field errors
 * land under their `<Field>`; anything else is one form-level message with
 * the request id.
 */
export function ProfileScreen() {
  const query = useMe();
  if (query.isPending || !query.data) {
    return <Spinner label="Loading your profile…" />;
  }
  return <ProfileForm me={query.data} />;
}

function ProfileForm({ me }: { me: Me }) {
  const { logout } = useSession();
  const update = useUpdateMe();
  const [values, setValues] = useState<FormValues>(() => fromMe(me));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  const zones = useMemo(listTimeZones, []);
  const zoneOptions = useMemo(() => {
    if (!zones) return undefined;
    // Keep a stored value the host's ICU does not list (alias, older data)
    // so the form never silently changes it.
    return zones.includes(values.timezone) ? zones : [values.timezone, ...zones];
  }, [zones, values.timezone]);

  const body = diff(me, values);
  const dirty = Object.keys(body).length > 0;

  const set = <K extends FieldName>(field: K, value: FormValues[K]) => {
    setValues((v) => ({ ...v, [field]: value }));
    setFieldErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
    setSaved(false);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dirty || update.isPending) return;
    setFormError(undefined);
    setFieldErrors({});
    setSaved(false);

    update.mutate(body, {
      onSuccess: () => setSaved(true),
      onError: (error) => {
        if (error instanceof ApiError && error.isValidation()) {
          const next: Partial<Record<FieldName, string>> = {};
          const unplaced: string[] = [];
          for (const { path, message } of error.errors) {
            if (isFieldName(path)) next[path] ??= message;
            else unplaced.push(message);
          }
          setFieldErrors(next);
          if (unplaced.length > 0 || error.errors.length === 0) {
            setFormError(unplaced.join(" ") || "Some of these values were not accepted.");
          }
          return;
        }
        const requestId = error instanceof ApiError ? error.requestId : undefined;
        setFormError(
          requestId
            ? `Couldn't save your profile. Reference: ${requestId}`
            : "Couldn't save your profile.",
        );
      },
    });
  };

  return (
    <Screen title="Profile">
      <form className={styles.form} onSubmit={onSubmit} noValidate data-testid="profile-form">
        <Field id="displayName" label="Display name" error={fieldErrors.displayName}
          hint="Shown in the app header. Leave blank to use your email.">
          {(control) => (
            <input
              {...control}
              type="text"
              maxLength={80}
              autoComplete="nickname"
              value={values.displayName}
              onChange={(e) => set("displayName", e.target.value)}
            />
          )}
        </Field>

        <Field id="unitPreference" label="Units" error={fieldErrors.unitPreference}>
          {(control) => (
            <select
              {...control}
              value={values.unitPreference}
              onChange={(e) => set("unitPreference", e.target.value as UnitPreference)}
            >
              {UNIT_PREFERENCE_VALUES.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field id="timezone" label="Time zone" error={fieldErrors.timezone}>
          {(control) =>
            zoneOptions ? (
              <select
                {...control}
                value={values.timezone}
                onChange={(e) => set("timezone", e.target.value)}
              >
                {zoneOptions.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            ) : (
              <input
                {...control}
                type="text"
                autoComplete="off"
                value={values.timezone}
                onChange={(e) => set("timezone", e.target.value)}
              />
            )
          }
        </Field>

        {formError ? (
          <p className={styles.formError} role="alert" data-testid="profile-form-error">
            {formError}
          </p>
        ) : null}
        {saved ? (
          <p className={styles.saved} role="status" data-testid="profile-saved">
            Saved.
          </p>
        ) : null}

        <Button type="submit" block busy={update.isPending} disabled={!dirty}>
          Save
        </Button>
      </form>

      <div className={styles.account}>
        <p className={styles.email}>Signed in as {me.email}</p>
        <Button variant="secondary" block onClick={logout}>
          Log out
        </Button>
      </div>
    </Screen>
  );
}
