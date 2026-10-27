import type { Exercise } from "@sin/core";

import { Button } from "../../ui/Button";
import { EXERCISES_COPY } from "./messages";

/** Interim (Spec 18.2 Task 4): the copy flow lands in Task 5. */
export function ForkButton(_props: { row: Exercise }) {
  return <Button variant="secondary">{EXERCISES_COPY.makeCopy}</Button>;
}
