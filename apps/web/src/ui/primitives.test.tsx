import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./Button";
import { Field } from "./Field";
import { ChartIcon, ClockIcon, DumbbellIcon, PersonIcon } from "./icons";
import { Screen } from "./Screen";

describe("AC9 — primitives behave (Spec 04.1 §2)", () => {
  describe("<Field>", () => {
    it("associates the label with the control via htmlFor / id", () => {
      render(
        <Field id="x" label="X">
          {(control) => <input {...control} />}
        </Field>,
      );
      const input = screen.getByLabelText("X");
      expect(input).toHaveAttribute("id", "x");
      expect(input).not.toHaveAttribute("aria-invalid");
      expect(input).not.toHaveAttribute("aria-describedby");
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("renders the error with role=alert, linked from the control by aria-describedby", () => {
      render(
        <Field id="x" label="X" error="bad">
          {(control) => <input {...control} />}
        </Field>,
      );
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("bad");
      expect(alert).toHaveAttribute("id", "x-error");
      const input = screen.getByLabelText("X");
      expect(input).toHaveAttribute("aria-describedby", "x-error");
      expect(input).toHaveAttribute("aria-invalid", "true");
    });

    it("describes the control by both hint and error when both are present", () => {
      render(
        <Field id="x" label="X" hint="help" error="bad">
          {(control) => <select {...control} />}
        </Field>,
      );
      expect(screen.getByLabelText("X")).toHaveAttribute(
        "aria-describedby",
        "x-hint x-error",
      );
      expect(screen.getByText("help")).toHaveAttribute("id", "x-hint");
    });
  });

  describe("<Button>", () => {
    it("reflects disabled and is not clickable", async () => {
      const onClick = vi.fn();
      render(
        <Button disabled onClick={onClick}>
          Go
        </Button>,
      );
      const button = screen.getByRole("button", { name: "Go" });
      expect(button).toBeDisabled();
      await userEvent.click(button);
      expect(onClick).not.toHaveBeenCalled();
    });

    it("busy sets aria-busy and blocks clicks", async () => {
      const onClick = vi.fn();
      render(
        <Button busy onClick={onClick}>
          Save
        </Button>,
      );
      const button = screen.getByRole("button", { name: "Save" });
      expect(button).toHaveAttribute("aria-busy", "true");
      expect(button).toBeDisabled();
      await userEvent.click(button);
      expect(onClick).not.toHaveBeenCalled();
    });

    it("is clickable, not busy, and type=button by default", async () => {
      const onClick = vi.fn();
      render(<Button onClick={onClick}>Tap</Button>);
      const button = screen.getByRole("button", { name: "Tap" });
      expect(button).not.toHaveAttribute("aria-busy");
      expect(button).toHaveAttribute("type", "button");
      await userEvent.click(button);
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("can be a submit button when asked", () => {
      render(<Button type="submit">Send</Button>);
      expect(screen.getByRole("button", { name: "Send" })).toHaveAttribute(
        "type",
        "submit",
      );
    });
  });

  describe("<Screen>", () => {
    it("renders an <h1> title inside a region labelled by it", () => {
      render(
        <Screen title="T">
          <p>body</p>
        </Screen>,
      );
      const heading = screen.getByRole("heading", { level: 1, name: "T" });
      const region = screen.getByRole("region", { name: "T" });
      expect(region).toContainElement(heading);
      expect(region).toHaveTextContent("body");
    });
  });

  describe("icons", () => {
    it("are decorative inline SVGs hidden from assistive tech", () => {
      const { container } = render(
        <>
          <DumbbellIcon />
          <ClockIcon />
          <ChartIcon />
          <PersonIcon />
        </>,
      );
      const svgs = container.querySelectorAll("svg");
      expect(svgs).toHaveLength(4);
      for (const svg of svgs) {
        expect(svg).toHaveAttribute("aria-hidden", "true");
        expect(svg).toHaveAttribute("stroke", "currentColor");
      }
      expect(screen.queryByRole("img")).toBeNull();
    });
  });
});
