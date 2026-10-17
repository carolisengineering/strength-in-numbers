/** What the API stores for a weight entered in lb: `weight_kg`, rounded to numeric(7,3). */
export const storedKg = (lb: number): number => Math.round(lb * 0.45359237 * 1000) / 1000;
