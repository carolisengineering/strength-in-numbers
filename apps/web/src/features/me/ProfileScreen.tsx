import { Screen } from "../../ui/Screen";

/**
 * Profile (Spec 04.1 §5). Piece 3 registers the route with this stub so the
 * shell + nav can be tested end to end; piece 6 replaces the body with the
 * real form (`useMe` + `useUpdateMe`, AC5–AC7).
 */
export function ProfileScreen() {
  return (
    <Screen title="Profile">
      <p data-testid="profile-screen">Profile form arrives in piece 6.</p>
    </Screen>
  );
}
