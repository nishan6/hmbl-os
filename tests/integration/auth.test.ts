import { describe, expect, it } from "vitest";
import { auth } from "@/server/auth/auth";
import { disableUser } from "@/server/users/service";
import { makeActor, TEST_PASSWORD } from "../helpers/actors";

async function signIn(email: string, password: string) {
  return auth.api.signInEmail({ body: { email, password }, asResponse: true });
}

describe("email and password sign-in", () => {
  it("signs in an active user and sets a session cookie", async () => {
    const user = await makeActor("viewer");
    const response = await signIn(user.email, TEST_PASSWORD);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/session_token/);
  });

  it("rejects a wrong password", async () => {
    const user = await makeActor("viewer");
    const response = await signIn(user.email, "wrong-password-here");
    expect(response.status).toBe(401);
  });

  it("refuses a disabled user even with the right password", async () => {
    const owner = await makeActor("owner");
    const user = await makeActor("viewer");
    await disableUser(owner, user.id);
    const response = await signIn(user.email, TEST_PASSWORD);
    expect(response.ok).toBe(false);
  });

  it("does not allow public sign-up", async () => {
    const response = await auth.api.signUpEmail({
      body: { name: "Intruder", email: "intruder@example.com", password: "a-long-enough-password" },
      asResponse: true,
    });
    expect(response.ok).toBe(false);
  });
});
