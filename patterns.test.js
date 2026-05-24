import { describe, expect, it } from "vitest";
import { findPatterns } from "./src/popup/patterns.js";

describe("findPatterns", () => {
  it("should detect global words, hook structures, and offer types", () => {
    const result = findPatterns([
      {
        text: "SALE $29 today only. Free shipping on every order.",
        headline: "! SALE $29",
        body: "Limited time deal with free shipping."
      },
      {
        text: "Limited time offer. Save 40% and get free shipping.",
        headline: "Limited time offer",
        body: "Save 40% before it ends soon."
      },
      {
        text: "How to get better leads. Free trial available now.",
        headline: "How to get better leads",
        body: "Start your free trial today."
      }
    ]);

    expect(result.totalAds).toBe(3);
    expect(result.frequentWords[0]).toEqual({ label: "free", count: 6 });
    expect(result.hookStructures).toEqual(
      expect.arrayContaining([
        { label: "symbol_offer_price", count: 1 },
        { label: "urgency_hook", count: 1 },
        { label: "how_to_hook", count: 1 }
      ])
    );
    expect(result.offerTypes).toEqual(
      expect.arrayContaining([
        { label: "free_offer", count: 3 },
        { label: "free_shipping", count: 2 },
        { label: "limited_time", count: 2 },
        { label: "free_trial", count: 1 },
        { label: "save_amount", count: 1 }
      ])
    );
  });

  it("should detect employment category signals", () => {
    const result = findPatterns([
      {
        categories: ["Employment"],
        headline: "Drivers wanted apply now",
        body: "Now hiring CDL drivers with weekly pay, benefits, sign on bonus and more home time."
      }
    ]);

    expect(result.hookStructures).toEqual(
      expect.arrayContaining([{ label: "job_recruiting_hook", count: 1 }])
    );
    expect(result.offerTypes).toEqual(
      expect.arrayContaining([
        { label: "job_hiring", count: 1 },
        { label: "job_weekly_pay", count: 1 },
        { label: "job_benefits", count: 1 },
        { label: "job_sign_on_bonus", count: 1 },
        { label: "job_home_time", count: 1 }
      ])
    );
  });

  it("should detect properties category signals", () => {
    const result = findPatterns([
      {
        categories: ["Properties"],
        headline: "New homes in a move-in ready community",
        body: "Get help with down payment and tour new homes from the low $400s this weekend."
      }
    ]);

    expect(result.hookStructures).toEqual(
      expect.arrayContaining([{ label: "property_listing_hook", count: 1 }])
    );
    expect(result.offerTypes).toEqual(
      expect.arrayContaining([
        { label: "property_down_payment", count: 1 },
        { label: "property_move_in_ready", count: 1 },
        { label: "property_new_homes", count: 1 },
        { label: "property_price_anchor", count: 1 },
        { label: "property_tour_cta", count: 1 }
      ])
    );
  });

  it("should detect finance category signals", () => {
    const result = findPatterns([
      {
        adType: "financial_products_and_services_ads",
        headline: "Save on insurance and get a quote today",
        body: "Bundle auto insurance and lower rates. Refinance your mortgage or loan with better terms."
      }
    ]);

    expect(result.hookStructures).toEqual(
      expect.arrayContaining([{ label: "finance_savings_hook", count: 1 }])
    );
    expect(result.offerTypes).toEqual(
      expect.arrayContaining([
        { label: "finance_get_quote", count: 1 },
        { label: "finance_rate_savings", count: 1 },
        { label: "finance_borrowing", count: 1 },
        { label: "finance_bundle", count: 1 }
      ])
    );
  });

  it("should detect political category signals", () => {
    const result = findPatterns([
      {
        categories: ["Issues, elections or politics"],
        headline: "Vote to protect our future",
        body: "Donate today, sign the petition, and take action with our campaign."
      }
    ]);

    expect(result.hookStructures).toEqual(
      expect.arrayContaining([{ label: "political_action_hook", count: 1 }])
    );
    expect(result.offerTypes).toEqual(
      expect.arrayContaining([
        { label: "politics_donate", count: 1 },
        { label: "politics_vote", count: 1 },
        { label: "politics_petition", count: 1 },
        { label: "politics_issue_action", count: 1 }
      ])
    );
  });
});
