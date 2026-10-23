import { describe, expect, it } from "vitest";
import {
  gstStateCode,
  isGstin,
  lineTax,
  rupeesInWords,
  supplyTypeFor,
  wholeNumberInWords,
} from "@/lib/gst";

const assam = { countryCode: "IN", stateCode: "18" };

describe("GSTIN and state", () => {
  it("accepts a well-formed GSTIN with a real state code", () => {
    expect(isGstin("18AABCH1234K1Z5")).toBe(true);
    expect(isGstin(" 27aabch1234k1z5 ")).toBe(true);
    expect(isGstin("99AABCH1234K1Z5")).toBe(false);
    expect(isGstin("18AABCH1234K1Y5")).toBe(false);
    expect(isGstin("18AABCH1234")).toBe(false);
  });

  it("takes the state from the GSTIN first, then the state name", () => {
    expect(gstStateCode({ gstin: "27AABCH1234K1Z5", region: "Assam" })).toBe("27");
    expect(gstStateCode({ gstin: null, region: "assam" })).toBe("18");
    expect(gstStateCode({ region: "Tamil Nadu" })).toBe("33");
    expect(gstStateCode({ gstin: "bad", region: "Nowhere" })).toBeNull();
    expect(gstStateCode({})).toBeNull();
  });
});

describe("supply type", () => {
  it("is intra-state only when both states match", () => {
    expect(supplyTypeFor(assam, { countryCode: "IN", stateCode: "18" })).toBe("INTRA_STATE");
    expect(supplyTypeFor(assam, { countryCode: "IN", stateCode: "27" })).toBe("INTER_STATE");
    expect(supplyTypeFor(assam, { countryCode: "IN", stateCode: null })).toBe("INTER_STATE");
  });

  it("is an export outside India, and not GST for an entity abroad", () => {
    expect(supplyTypeFor(assam, { countryCode: "AE", stateCode: null })).toBe("EXPORT");
    expect(
      supplyTypeFor({ countryCode: "AE", stateCode: null }, { countryCode: "IN", stateCode: "18" }),
    ).toBe("NON_GST");
  });

  it("does not treat an entity with no known state as intra-state", () => {
    expect(
      supplyTypeFor({ countryCode: "IN", stateCode: null }, { countryCode: "IN", stateCode: null }),
    ).toBe("INTER_STATE");
  });
});

describe("line tax", () => {
  it("splits intra-state GST into equal CGST and SGST", () => {
    expect(lineTax(100_000_00n, 1800, "INTRA_STATE")).toEqual({
      cgstMinor: 9_000_00n,
      sgstMinor: 9_000_00n,
      igstMinor: 0n,
      otherTaxMinor: 0n,
      taxMinor: 18_000_00n,
    });
  });

  it("rounds each half separately, so CGST always equals SGST", () => {
    // 0.09 × 1.11 = 0.0999 → 0.10 each half
    const t = lineTax(111n, 1800, "INTRA_STATE");
    expect(t.cgstMinor).toBe(10n);
    expect(t.sgstMinor).toBe(10n);
    expect(t.taxMinor).toBe(20n);
  });

  it("charges IGST between states and on exports", () => {
    expect(lineTax(70_000_00n, 1800, "INTER_STATE")).toMatchObject({
      igstMinor: 12_600_00n,
      taxMinor: 12_600_00n,
    });
    expect(lineTax(10_000n, 0, "EXPORT").taxMinor).toBe(0n);
  });

  it("puts tax outside India in one amount", () => {
    expect(lineTax(10_000n, 500, "NON_GST")).toMatchObject({
      otherTaxMinor: 500n,
      igstMinor: 0n,
      taxMinor: 500n,
    });
  });

  it("rounds half away from zero, including on negative amounts", () => {
    expect(lineTax(25n, 1800, "INTER_STATE").taxMinor).toBe(5n); // 4.5 → 5
    expect(lineTax(-25n, 1800, "INTER_STATE").taxMinor).toBe(-5n);
  });
});

describe("amounts in words", () => {
  it("uses Indian grouping", () => {
    expect(wholeNumberInWords(0n)).toBe("Zero");
    expect(wholeNumberInWords(15n)).toBe("Fifteen");
    expect(wholeNumberInWords(1_234_567n)).toBe(
      "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven",
    );
    expect(wholeNumberInWords(250_000_000n)).toBe("Twenty Five Crore");
    expect(wholeNumberInWords(1_00_00_00_000n)).toBe("One Hundred Crore");
  });

  it("prints rupees and paise", () => {
    expect(rupeesInWords(82_600_00n)).toBe("Rupees Eighty Two Thousand Six Hundred Only");
    expect(rupeesInWords(1_050n)).toBe("Rupees Ten and Fifty Paise Only");
  });
});
