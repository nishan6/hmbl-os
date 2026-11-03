import { describe, expect, it } from "vitest";
import {
  documentDate,
  documentDateRange,
  documentMoney,
  documentTerms,
  groupInvoiceLines,
  printedQuantity,
  type LayoutLine,
} from "@/lib/invoice-layout";

const line = (p: Partial<LayoutLine>): LayoutLine => ({
  id: Math.random().toString(),
  section: null,
  description: "Line",
  details: null,
  quantity: "1.000",
  unitPriceMinor: 0n,
  amountMinor: 0n,
  ...p,
});

describe("groupInvoiceLines", () => {
  it("letters lines without a section and numbers their details", () => {
    const [a] = groupInvoiceLines([
      line({
        description: "Production / Operation",
        details: "Camera Operator\n\n Audio Engineer ",
        amountMinor: 16_200_000n,
      }),
    ]);
    expect(a).toMatchObject({ letter: "A", heading: "Production / Operation", items: [] });
    expect(a!.line!.details).toEqual(["Camera Operator", "Audio Engineer"]);
    expect(a!.amountMinor).toBe(16_200_000n);
  });

  it("groups consecutive lines under one section and totals them", () => {
    const groups = groupInvoiceLines([
      line({ section: "Production / Operation", description: "LD", amountMinor: 2_600_000n }),
      line({ section: "Production / Operation", description: "Op", amountMinor: 2_240_000n }),
      line({ section: "Pre-Production", description: "Plot", amountMinor: 2_500_000n }),
      line({ section: "Production / Operation", description: "Late", amountMinor: 100n }),
    ]);
    expect(groups.map((g) => [g.letter, g.heading, g.items.length])).toEqual([
      ["A", "Production / Operation", 2],
      ["B", "Pre-Production", 1],
      ["C", "Production / Operation", 1],
    ]);
    expect(groups[0]!.amountMinor).toBe(4_840_000n);
    expect(groups[0]!.items.map((i) => i.number)).toEqual([1, 2]);
  });
});

describe("document formatting", () => {
  it("prints whole rupees without paise, and keeps paise when there are some", () => {
    expect(documentMoney(16_200_000n, "INR")).toBe("₹1,62,000");
    expect(documentMoney(16_200_050n, "INR")).toBe("₹1,62,000.50");
  });

  it("writes dates and ranges the HMBL way", () => {
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    expect(documentDate(d("2026-05-22"))).toBe("22.05.2026");
    expect(documentDateRange(d("2026-06-09"), d("2026-06-12"))).toBe("09 – 12.06.2026");
    expect(documentDateRange(d("2026-05-31"), d("2026-06-05"))).toBe("31.05.2026 – 05.06.2026");
    expect(documentDateRange(d("2026-09-05"), d("2026-09-05"))).toBe("05.09.2026");
    expect(documentDateRange(null, null)).toBeNull();
  });

  it("leaves a quantity of one off", () => {
    expect(printedQuantity("1.000")).toBeNull();
    expect(printedQuantity("13.000")).toBe("13");
    expect(printedQuantity("2.500")).toBe("2.5");
  });

  it("ends the terms with the GST and SAC lines", () => {
    expect(
      documentTerms({
        terms: "50% payment to be paid before the commencement of work.\n",
        currency: "INR",
        subtotalMinor: 16_200_000n,
        taxRatesBps: [1800, 1800, 0],
        sacCodes: ["999621", null, "999621"],
      }),
    ).toEqual([
      "50% payment to be paid before the commencement of work.",
      "18% GST applicable on ₹1,62,000/- for service rendition.",
      "SAC Code applicable on production: 999621.",
    ]);
  });
});
