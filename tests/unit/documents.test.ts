import { describe, expect, it } from "vitest";
import {
  canPreview,
  cleanFileName,
  contentTypeFor,
  isBlocked,
} from "@/server/projects/document-rules";
import { CLOSEOUT_ITEMS, outstandingCloseout } from "@/server/projects/closeout-rules";
import { formatBytes } from "@/lib/format";

describe("document rules", () => {
  it("keeps only a clean base name", () => {
    expect(cleanFileName("C:\\Users\\a\\Rider v2.pdf")).toBe("Rider v2.pdf");
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName('bad\u0000"name\n.txt')).toBe("badname.txt");
    const long = cleanFileName(`${"a".repeat(300)}.pdf`);
    expect(long).toHaveLength(255);
    expect(long.endsWith(".pdf")).toBe(true);
  });

  it("refuses programs and scripts, whatever the case", () => {
    expect(isBlocked("setup.EXE")).toBe(true);
    expect(isBlocked("deploy.sh")).toBe(true);
    expect(isBlocked("stage-plot.dwg")).toBe(false);
    expect(isBlocked("show.mov")).toBe(false);
    expect(isBlocked("README")).toBe(false);
  });

  it("previews only PDFs and images, typed by extension", () => {
    expect(contentTypeFor("plot.PDF", "text/html")).toBe("application/pdf");
    expect(contentTypeFor("cue.xlsx", "application/vnd.ms-excel")).toBe("application/vnd.ms-excel");
    expect(contentTypeFor("x.bin", "not a type")).toBe("application/octet-stream");
    expect(canPreview("photo.jpeg")).toBe(true);
    expect(canPreview("logo.svg")).toBe(false);
  });

  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2_500_000)).toBe("2.4 MB");
    expect(formatBytes(5n * 1024n ** 3n)).toBe("5.0 GB");
  });
});

describe("closeout checklist", () => {
  it("lists what is neither done nor not applicable", () => {
    const left = outstandingCloseout([
      { key: "INVOICES_ISSUED", doneAt: new Date(), notApplicable: false },
      { key: "CREW_SETTLED", doneAt: null, notApplicable: true },
      { key: "FINAL_REPORT", doneAt: null, notApplicable: false },
    ]);
    expect(left.map((i) => i.key)).toEqual([
      "PAYMENTS_COLLECTED",
      "VENDOR_BILLS_RECEIVED",
      "EQUIPMENT_RETURNED",
      "EXPENSES_RECONCILED",
      "FINAL_REPORT",
    ]);
  });

  it("keeps an item open while the records show it isn't finished, even if ticked", () => {
    const rows = CLOSEOUT_ITEMS.map(({ key }) => ({
      key,
      doneAt: new Date(),
      notApplicable: false,
    }));
    expect(outstandingCloseout(rows)).toEqual([]);
    expect(outstandingCloseout(rows, ["EQUIPMENT_RETURNED"]).map((i) => i.key)).toEqual([
      "EQUIPMENT_RETURNED",
    ]);
  });
});
