import { Banknote, FileQuestion, HandCoins, Lightbulb, PackageX } from "lucide-react";

/** The three business problems from docs/plan.md, with the playbook that works each one. */
export const AREA: Record<string, { label: string; icon: typeof Lightbulb; playbook: string }> = {
  shortage_recovery: { label: "Shortage recovery", icon: PackageX, playbook: "shortage-dispute" },
  unexplained_deductions: { label: "Unexplained deductions", icon: FileQuestion, playbook: "unexplained-deductions" },
  cash_collection: { label: "Cash collection", icon: Banknote, playbook: "cash-collection" },
  coop: { label: "Co-op", icon: HandCoins, playbook: "" },
};
