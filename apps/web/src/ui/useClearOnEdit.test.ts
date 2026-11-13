import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useClearOnEdit } from "./useClearOnEdit";

type Errors = Partial<Record<"name" | "notes", string>>;

describe("minor 313 — useClearOnEdit: a field's error clears when that field changes", () => {
  it("edit hides only that field's message; the same object keeps it hidden", () => {
    const errors: Errors = { name: "Enter a name.", notes: "Too long." };
    const { result, rerender } = renderHook(({ e }) => useClearOnEdit(e), { initialProps: { e: errors } });
    expect(result.current.of("name")).toBe("Enter a name.");
    act(() => result.current.edit("name"));
    expect(result.current.of("name")).toBeUndefined();
    expect(result.current.of("notes")).toBe("Too long.");
    expect(result.current.visible).toEqual({ notes: "Too long." });
    rerender({ e: errors });
    expect(result.current.of("name")).toBeUndefined();
  });

  it("a new errors object — the next Done or Save — shows every message again, even the same text", () => {
    const { result, rerender } = renderHook(({ e }) => useClearOnEdit(e), { initialProps: { e: { name: "Enter a name." } as Errors } });
    act(() => result.current.edit("name"));
    expect(result.current.of("name")).toBeUndefined();
    rerender({ e: { name: "Enter a name." } });
    expect(result.current.of("name")).toBe("Enter a name.");
  });

  it("editing a field with no message never adds one, and null or empty messages read as none", () => {
    const { result } = renderHook(() => useClearOnEdit<"name" | "notes">({ name: null, notes: "" }));
    act(() => result.current.edit("name", "notes"));
    expect(result.current.of("name")).toBeUndefined();
    expect(result.current.of("notes")).toBeUndefined();
    expect(result.current.visible).toEqual({});
  });
});
