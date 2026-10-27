import { describe, expect, it } from "vitest";
import { passwordProblem } from "@/lib/password-policy";

describe("password policy", () => {
  it.each(["abcdef1!x", "Rocket#2026", "p@ssw0rd!long"])("accepts %s", (pw) => {
    expect(passwordProblem(pw)).toBeNull();
  });

  it.each([
    ["abc1!xy", "at least 9"],
    ["abcdefgh!", "number"],
    ["abcdefgh1", "special character"],
    ["abcdefg 1", "special character"],
    ["x".repeat(127) + "1!", "at most 128"],
  ])("rejects %s (%s)", (pw, expected) => {
    expect(passwordProblem(pw)).toMatch(new RegExp(expected));
  });
});
