/** Spec 20.0: the shared pairing surface 20.1 and 20.2 use. */
// The component file is PairingCardList.tsx: a PairingCards.tsx would collide with pairingCards.ts on case-insensitive disks.
export { PairingCards, type PairingCardsProps } from "./PairingCardList";
export {
  chooseExisting,
  chooseMatch,
  chooseNew,
  chooseSkip,
  decisionsOf,
  initialPairingCards,
  problemFor,
  setNewValue,
  setRule,
  validity,
  type PairingCard,
  type PairingDecision,
  type PairingNeed,
  type PairingProblem,
} from "./pairingCards";
