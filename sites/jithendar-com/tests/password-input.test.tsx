// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PasswordInput } from "@/components/ui/PasswordInput";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderForm(onSubmit = vi.fn((e: SubmitEvent) => e.preventDefault())) {
  act(() =>
    root.render(
      <form>
        <PasswordInput id="password" name="password" autoComplete="current-password" required minLength={8} />
        <PasswordInput id="confirm" name="confirm" autoComplete="new-password" />
        <button type="submit">Sign in</button>
      </form>,
    ),
  );
  const form = container.querySelector("form")!;
  form.addEventListener("submit", onSubmit);
  const [password, confirm] = [...container.querySelectorAll("input")] as HTMLInputElement[];
  const [togglePassword, toggleConfirm] = [...container.querySelectorAll('button[type="button"]')] as HTMLButtonElement[];
  return { form, password: password!, confirm: confirm!, togglePassword: togglePassword!, toggleConfirm: toggleConfirm!, onSubmit };
}

describe("PasswordInput", () => {
  it("is hidden by default and renders an accessible, non-submitting toggle on the server too", () => {
    const html = renderToStaticMarkup(<PasswordInput id="p" name="password" autoComplete="new-password" />);
    expect(html).toContain('type="password"');
    expect(html).toMatch(/autocomplete="new-password"/i);
    expect(html).toMatch(/<button type="button"[^>]*aria-label="Show password"/);
    expect(html).toContain('aria-controls="p"');
  });

  it("toggles one field at a time, with matching labels, and never submits the form", () => {
    const { password, confirm, togglePassword, toggleConfirm, onSubmit } = renderForm();
    expect(password.type).toBe("password");
    expect(confirm.type).toBe("password");

    act(() => togglePassword.click());
    expect(password.type).toBe("text");
    expect(togglePassword.getAttribute("aria-label")).toBe("Hide password");
    expect(confirm.type).toBe("password");
    expect(toggleConfirm.getAttribute("aria-label")).toBe("Show password");

    act(() => togglePassword.click());
    expect(password.type).toBe("password");
    expect(togglePassword.getAttribute("aria-label")).toBe("Show password");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the name, autocomplete and validation attributes, and the typed value", () => {
    const { password, togglePassword } = renderForm();
    password.value = "correct horse";
    act(() => togglePassword.click());
    expect(password.value).toBe("correct horse");
    expect(password.name).toBe("password");
    expect(password.getAttribute("autocomplete")).toBe("current-password");
    expect(password.required).toBe(true);
    expect(password.minLength).toBe(8);
  });

  it("keeps focus and the cursor position in the field", () => {
    const { password, togglePassword } = renderForm();
    password.value = "secret-value";
    password.focus();
    password.setSelectionRange(3, 6);
    act(() => togglePassword.click());
    expect(document.activeElement).toBe(password);
    expect([password.selectionStart, password.selectionEnd]).toEqual([3, 6]);
  });

  it("returns to hidden when the form is submitted, so password managers see a password field", () => {
    const { form, password, togglePassword, onSubmit } = renderForm();
    act(() => togglePassword.click());
    expect(password.type).toBe("text");
    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(password.type).toBe("password");
  });
});
