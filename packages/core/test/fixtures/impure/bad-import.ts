// Fixture for Spec 02 §2 AC2 — NOT part of the package. The purity check must
// flag the Node-builtin import below. Never imported by src/.
import { readFileSync } from "node:fs";

export const boom = readFileSync;
