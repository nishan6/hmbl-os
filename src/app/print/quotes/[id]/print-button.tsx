"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button variant="primary" onClick={() => window.print()}>
      <Printer aria-hidden />
      Print or save as PDF
    </Button>
  );
}
