import { dayText } from "../../../ui/dateText";

/**
 * Spec 20.2 AC2: the day a link was last synced, en-US "Sat, Oct 24", in the device zone (it is an instant, unlike
 * the summary's stored `localDate`). The form is the app's one day form (Spec 17.13). `timeZone` is for tests only.
 */
export function sentDay(iso: string, opts: { timeZone?: string } = {}): string {
  return dayText(new Date(iso), opts);
}
