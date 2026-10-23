import { describe, expect, it } from "vitest";
import { normalizeClientName, websiteDomain } from "@/server/crm/normalize";

describe("normalizeClientName", () => {
  it.each([
    ["Star Sports India Pvt. Ltd.", "star sports"],
    ["STAR SPORTS", "star sports"],
    ["The Live Co.", "live"],
    ["Café Events FZ-LLC", "cafe events"],
    ["Rock & Roll Productions", "rock and roll productions"],
    ["The Company", "the company"],
  ])("%j → %j", (name, normalized) => {
    expect(normalizeClientName(name)).toBe(normalized);
  });
});

describe("websiteDomain", () => {
  it.each([
    ["https://www.Example.com/about", "example.com"],
    ["example.com", "example.com"],
    ["http://shop.example.co.in?x=1", "shop.example.co.in"],
    ["", null],
    [null, null],
  ])("%j → %j", (site, domain) => {
    expect(websiteDomain(site)).toBe(domain);
  });
});
