import { describe, expect, it } from "vitest";

import {
  assertHasRole,
  ForbiddenError,
  hasAnyRole,
  type CurrentUser,
} from "@/lib/auth/roles";

function user(roles: CurrentUser["roles"]): CurrentUser {
  return { id: "u1", email: "u@demo.local", fullName: "Demo", roles };
}

describe("hasAnyRole", () => {
  it("is true when the user holds one of the required roles", () => {
    expect(hasAnyRole(user(["finance"]), ["owner", "finance"])).toBe(true);
  });

  it("is false when the user holds none of the required roles", () => {
    expect(hasAnyRole(user(["sales"]), ["owner", "finance"])).toBe(false);
  });

  it("is false for a missing user", () => {
    expect(hasAnyRole(null, ["owner"])).toBe(false);
  });

  it("treats an empty requirement list as open to everyone", () => {
    expect(hasAnyRole(user([]), [])).toBe(true);
  });
});

describe("assertHasRole", () => {
  it("returns the user when authorised", () => {
    const value = user(["owner"]);
    expect(assertHasRole(value, ["owner"])).toBe(value);
  });

  it("throws ForbiddenError when the user is missing", () => {
    expect(() => assertHasRole(null, ["owner"])).toThrow(ForbiddenError);
  });

  it("throws ForbiddenError when the role is missing", () => {
    expect(() => assertHasRole(user(["sales"]), ["admin"])).toThrow(
      ForbiddenError,
    );
  });
});
