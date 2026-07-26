import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/password";

describe("Argon2id password hashing", () => {
  it("hashes and verifies without retaining plaintext", async () => {
    const password = "a-long-development-password";
    const hashed = await hashPassword(password);
    expect(hashed).not.toContain(password);
    await expect(verifyPassword({ password, hash: hashed })).resolves.toBe(true);
    await expect(
      verifyPassword({ password: "wrong-password", hash: hashed }),
    ).resolves.toBe(false);
  });
});
