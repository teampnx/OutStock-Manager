export type PricingFaqItem = {
  question: string;
  answer: string;
};

export type UpgradeBenefit = {
  title: string;
  description: string;
  icon: "automation" | "analytics" | "support" | "scale";
};

export const UPGRADE_BENEFITS: UpgradeBenefit[] = [
  {
    title: "Higher catalog limits",
    description:
      "Track more products and enable push-down sorting on more manual collections as your store grows.",
    icon: "scale",
  },
  {
    title: "Automatic sold-out sorting",
    description:
      "Sold-out products move to the bottom of enabled collections without manual reordering.",
    icon: "automation",
  },
  {
    title: "Longer activity history",
    description:
      "Review reorder, restore, and sync events over a longer window to audit automation.",
    icon: "analytics",
  },
  {
    title: "Priority support",
    description:
      "Growth and Pro plans include faster help when you need assistance with setup or troubleshooting.",
    icon: "support",
  },
];

export const PRICING_FAQ: PricingFaqItem[] = [
  {
    question: "How does billing work?",
    answer:
      "Paid plans are billed through Shopify on your monthly invoice. Upgrades open Shopify's secure billing approval page. You can downgrade to Free at any time from the Pricing page.",
  },
  {
    question: "Can I try a paid plan before committing?",
    answer:
      "During development, charges run in test mode and are not billed to your store. In production, Shopify handles proration when you change plans mid-cycle.",
  },
  {
    question: "What happens when I downgrade to Free?",
    answer:
      "Your existing data stays in place. If you exceed Free plan limits, you won't be able to enable additional collections until you upgrade or disable some.",
  },
  {
    question: "Which collections are supported?",
    answer:
      "Curatify works with manual collections. Collections using automated sort rules (best selling, price, etc.) cannot be reordered and are shown as blocked in the Collections page.",
  },
  {
    question: "Do sold-out products stay at the bottom forever?",
    answer:
      "Only while they remain sold out. When inventory returns, products can be restored to their original position or the top of the collection based on your Settings.",
  },
  {
    question: "Is my data safe if I uninstall the app?",
    answer:
      "Uninstalling removes app-specific data from our systems. Your Shopify products and collections are never deleted by Curatify.",
  },
];
