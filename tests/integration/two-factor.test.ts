import { describe, expect, it } from "vitest";
import { auth } from "@/server/auth/auth";
import { db } from "@/server/db";
import { makeActor, TEST_PASSWORD } from "../helpers/actors";
import { totpCode, totpCodeForSecret } from "../helpers/totp";
import { seedDemoTwoFactor } from "../../prisma/seed/two-factor";
import { DEMO_TOTP_SECRET } from "../../prisma/seed/demo-credentials";

/** Keeps the cookies a browser would hold across calls. */
class Jar {
  private cookies = new Map<string, string>();
  store(response: Response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(";");
      const [name, ...value] = pair!.split("=");
      const expired = attributes.some((a) => /max-age=0/i.test(a.trim()));
      if (expired) this.cookies.delete(name!.trim());
      else this.cookies.set(name!.trim(), value.join("="));
    }
    return response;
  }
  get headers() {
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    return new Headers({ cookie });
  }
  has(fragment: string) {
    return [...this.cookies.keys()].some((k) => k.includes(fragment));
  }
}

async function signIn(jar: Jar, email: string) {
  return jar.store(
    await auth.api.signInEmail({
      body: { email, password: TEST_PASSWORD },
      headers: jar.headers,
      asResponse: true,
    }),
  );
}

/** Signs in and turns on two-factor; returns the authenticator URI and backup codes. */
async function enableTwoFactor(email: string) {
  const jar = new Jar();
  await signIn(jar, email);
  const enabled = await auth.api.enableTwoFactor({
    body: { password: TEST_PASSWORD },
    headers: jar.headers,
  });
  if (enabled.method !== "totp") throw new Error("expected an authenticator-app setup");
  const { totpURI, backupCodes } = enabled;
  const verified = jar.store(
    await auth.api.verifyTOTP({
      body: { code: totpCode(totpURI) },
      headers: jar.headers,
      asResponse: true,
    }),
  );
  expect(verified.status).toBe(200);
  return { jar, totpURI, backupCodes };
}

const auditActions = async (userId: string) =>
  (
    await db.auditEvent.findMany({
      where: { targetId: userId },
      orderBy: { occurredAt: "asc" },
      select: { action: true },
    })
  ).map((e) => e.action);

describe("two-factor sign-in", () => {
  it("is turned on by confirming a code from the authenticator app", async () => {
    const user = await makeActor("viewer");
    await enableTwoFactor(user.email);

    const stored = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.twoFactorEnabled).toBe(true);
    const row = await db.twoFactor.findFirstOrThrow({ where: { userId: user.id } });
    // Encrypted at rest, never the raw secret or codes.
    expect(row.secret).not.toMatch(/^[A-Za-z0-9]{32}$/);
    expect(row.backupCodes).not.toContain("-");
    expect(
      (await auditActions(user.id)).filter(
        (a) => !a.startsWith("user.role") && a !== "user.created",
      ),
    ).toEqual(["auth.signed_in", "user.two_factor_enabled"]);
  });

  it("asks for a code after the password and only then starts a session", async () => {
    const user = await makeActor("viewer");
    const { totpURI } = await enableTwoFactor(user.email);

    const jar = new Jar();
    const first = await signIn(jar, user.email);
    expect(await first.json()).toMatchObject({ twoFactorRedirect: true });
    expect(jar.has("session_token")).toBe(false);
    expect(await auth.api.getSession({ headers: jar.headers })).toBeNull();

    const wrong = await auth.api.verifyTOTP({
      body: { code: "000000" },
      headers: jar.headers,
      asResponse: true,
    });
    expect(wrong.status).toBe(401);

    jar.store(
      await auth.api.verifyTOTP({
        body: { code: totpCode(totpURI) },
        headers: jar.headers,
        asResponse: true,
      }),
    );
    const session = await auth.api.getSession({ headers: jar.headers });
    expect(session?.user.id).toBe(user.id);
  });

  it("logs a sign-in once, after the code, and logs wrong codes", async () => {
    const user = await makeActor("viewer");
    const { totpURI } = await enableTwoFactor(user.email);
    const before = (await auditActions(user.id)).length;

    const jar = new Jar();
    await signIn(jar, user.email);
    await auth.api
      .verifyTOTP({ body: { code: "000000" }, headers: jar.headers, asResponse: true })
      .catch(() => undefined);
    await auth.api.verifyTOTP({
      body: { code: totpCode(totpURI) },
      headers: jar.headers,
      asResponse: true,
    });

    expect((await auditActions(user.id)).slice(before)).toEqual(["auth.signed_in"]);
    const failures = await db.auditEvent.count({ where: { action: "auth.two_factor_failed" } });
    expect(failures).toBeGreaterThanOrEqual(1);
  });

  it("accepts each backup code once", async () => {
    const user = await makeActor("viewer");
    const { backupCodes } = await enableTwoFactor(user.email);
    const code = backupCodes[0]!;

    const first = new Jar();
    await signIn(first, user.email);
    first.store(
      await auth.api.verifyBackupCode({
        body: { code },
        headers: first.headers,
        asResponse: true,
      }),
    );
    expect((await auth.api.getSession({ headers: first.headers }))?.user.id).toBe(user.id);

    const second = new Jar();
    await signIn(second, user.email);
    const reused = await auth.api.verifyBackupCode({
      body: { code },
      headers: second.headers,
      asResponse: true,
    });
    expect(reused.ok).toBe(false);
  });
});

describe("two-factor policy", () => {
  it("lets an optional user turn it off, and logs it", async () => {
    const user = await makeActor("viewer");
    const { jar } = await enableTwoFactor(user.email);
    const response = await auth.api.disableTwoFactor({
      body: { password: TEST_PASSWORD },
      headers: jar.headers,
      asResponse: true,
    });
    expect(response.status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).twoFactorEnabled).toBe(
      false,
    );
    expect(await auditActions(user.id)).toContain("user.two_factor_disabled");
  });

  it("does not let a role that requires it turn it off", async () => {
    const user = await makeActor("finance");
    const { jar } = await enableTwoFactor(user.email);
    await expect(
      auth.api.disableTwoFactor({ body: { password: TEST_PASSWORD }, headers: jar.headers }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).twoFactorEnabled).toBe(
      true,
    );
  });
});

describe("demo seed", () => {
  it("gives required roles a working demo authenticator secret and skips others", async () => {
    const owner = await makeActor("owner");
    const viewer = await makeActor("viewer");
    await seedDemoTwoFactor(db, [owner.email, viewer.email]);
    expect((await db.user.findUniqueOrThrow({ where: { id: viewer.id } })).twoFactorEnabled).toBe(
      false,
    );

    const jar = new Jar();
    await signIn(jar, owner.email);
    jar.store(
      await auth.api.verifyTOTP({
        body: { code: totpCodeForSecret(DEMO_TOTP_SECRET) },
        headers: jar.headers,
        asResponse: true,
      }),
    );
    expect((await auth.api.getSession({ headers: jar.headers }))?.user.id).toBe(owner.id);
  });
});
