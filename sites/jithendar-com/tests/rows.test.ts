import { describe, expect, it } from "vitest";
import { rowsOf } from "@/db/rows";

describe("rowsOf", () => {
  it("reads both driver result shapes", () => {
    expect(rowsOf<{ n: number }>([{ n: 1 }])).toEqual([{ n: 1 }]); // postgres.js
    expect(rowsOf<{ n: number }>({ rows: [{ n: 2 }] })).toEqual([{ n: 2 }]); // PGlite
    expect(rowsOf(undefined)).toEqual([]);
  });
});
