import {
  EquipmentResponse,
  MuscleGroupsResponse,
  type Equipment,
  type MuscleGroup,
} from "@sin/core";
import { useQuery } from "@tanstack/react-query";

import { useApi } from "../../auth/useApi";

const byDisplayOrder = <T extends { displayOrder: number }>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => a.displayOrder - b.displayOrder);

/**
 * `GET /v1/muscle-groups` (Spec 06.0 §6.8). A plain query, not the catalog
 * store: the table is tiny, changes only on a deploy, and has no local merge
 * state. `staleTime: Infinity` → one request per page load.
 */
export function useMuscleGroups() {
  const api = useApi();
  return useQuery<MuscleGroup[]>({
    queryKey: ["muscle-groups"],
    queryFn: async () =>
      byDisplayOrder((await api.get("/v1/muscle-groups", MuscleGroupsResponse)).muscleGroups),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

/** `GET /v1/equipment` — same shape and caching as `useMuscleGroups`. */
export function useEquipment() {
  const api = useApi();
  return useQuery<Equipment[]>({
    queryKey: ["equipment"],
    queryFn: async () =>
      byDisplayOrder((await api.get("/v1/equipment", EquipmentResponse)).equipment),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}
