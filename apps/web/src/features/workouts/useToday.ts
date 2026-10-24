import { useEffect, useState } from "react";

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/**
 * "Today" for labels that read differently on another day (the live header's "Started …", deferred
 * minor 11). Re-renders once at the next local midnight, and on becoming visible if the day changed
 * meanwhile; the returned Date is stable within a day.
 */
export function useToday(): Date {
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => {
      const now = new Date();
      if (dayKey(now) !== dayKey(today)) setToday(now);
    };
    const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const id = setTimeout(refresh, midnight.getTime() - Date.now() + 1000);
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [today]);
  return today;
}
