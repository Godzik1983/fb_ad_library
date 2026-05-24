import { describe, expect, it } from "vitest";
import { analyze } from "./src/popup/analyzer.js";

describe("analyze", () => {
  it('should detect strong hook from "free"', () => {
    const result = analyze({
      text: "Simple text",
      headline: "Get free access now",
      images: []
    });

    expect(result.hook).toBe("Get free access now");
  });

  it('should detect offer from "discount"', () => {
    const result = analyze({
      text: "Huge discount this week",
      headline: "Offer",
      images: []
    });

    expect(result.offer).toBe("Huge discount this week");
  });

  it('should detect urgency from "limited"', () => {
    const result = analyze({
      text: "Limited time only",
      headline: "Act",
      images: []
    });

    expect(result.psychology).toBe("Uses urgency to push action.");
  });

  it("should compute score correctly", () => {
    const result = analyze({
      text: "This is a long enough text for scoring, definitely above forty chars.",
      headline: "Strong headline",
      images: ["https://img/1.jpg"]
    });

    expect(result.scoreBreakdown).toEqual({
      hook_quality: expect.any(Number),
      offer_strength: expect.any(Number),
      CTA_presence: expect.any(Number),
      psychology_trigger: expect.any(Number),
      visual_presence: expect.any(Number)
    });
    expect(result.score).toBe(
      result.scoreBreakdown.hook_quality +
        result.scoreBreakdown.offer_strength +
        result.scoreBreakdown.CTA_presence +
        result.scoreBreakdown.psychology_trigger +
        result.scoreBreakdown.visual_presence
    );
    expect(result.score).toBeGreaterThan(0);
  });

  it("should fallback headline from text", () => {
    const result = analyze({
      text: "This text is long enough to become fallback headline content for analysis.",
      headline: "",
      images: []
    });

    expect(typeof result.hook).toBe("string");
    expect(result.hook.length).toBeGreaterThan(0);
  });

  it("should parse ad library card fields and CTA separately", () => {
    const result = analyze({
      text: [
        "Library ID: 1139045806861719",
        "Started running on 12 Jan 2022",
        "Companies are competing to hire drivers just like you!",
        "You can choose a higher paying job, with better benefits and greater home-time.",
        "DRIVERSJOBCHOICE.COM",
        "Truck Drivers - Help Wanted",
        "Up to $12K Sign On Bonus",
        "This ad has multiple versions",
        "Apply Now"
      ].join(" "),
      headline: "",
      rawLines: [
        "Library ID: 1139045806861719",
        "Started running on 12 Jan 2022",
        "Companies are competing to hire drivers just like you!",
        "You can choose a higher paying job, with better benefits and greater home-time.",
        "DRIVERSJOBCHOICE.COM",
        "Truck Drivers - Help Wanted",
        "Up to $12K Sign On Bonus",
        "This ad has multiple versions",
        "Apply Now"
      ],
      buttons: ["Open Drop-down", "Apply Now"],
      ctaButton: "Apply Now",
      platforms: ["Facebook", "Instagram", "Audience Network"],
      categories: ["Employment"],
      images: ["https://img/1.jpg"]
    });

    expect(result.hook).toContain("Companies are competing to hire drivers just like you!");
    expect(result.cta).toBe("Apply Now");
    expect(result.domain).toBe("DRIVERSJOBCHOICE.COM");
    expect(result.caption).toBe("Up to $12K Sign On Bonus");
    expect(result.libraryId).toBe("1139045806861719");
    expect(result.startedRunning).toContain("12 Jan 2022");
    expect(result.variants).toContain("multiple versions");
    expect(result.platforms).toEqual(["Facebook", "Instagram", "Audience Network"]);
    expect(result.categories).toEqual(["Employment"]);
  });

  it("should fallback category from ad_type when category icon is not readable", () => {
    const result = analyze({
      text: "Library ID: 1 Started running on 12 Jan 2022 Apply today at driversjobchoice.com",
      headline: "",
      rawLines: [
        "Library ID: 1",
        "Started running on 12 Jan 2022",
        "Platforms",
        "Categories",
        "Apply today at driversjobchoice.com",
        "Truck Drivers - Help Wanted",
        "Up to $12K Sign On Bonus"
      ],
      buttons: ["Apply Now"],
      platforms: ["Facebook", "Instagram"],
      adType: "employment_ads",
      images: []
    });

    expect(result.categories).toEqual(["Employment"]);
  });

  it("should prefer footer text for caption and parse get quote CTA", () => {
    const result = analyze({
      text: [
        "Library ID: 1558831445668603",
        "Started running on 1 May 2026",
        "Progressive",
        "You read that right: Drivers who switch and save with Progressive save $946 on average!",
        "0:00 / 0:06",
        "Switch and you could save.",
        "Get Quote"
      ].join(" "),
      headline: "",
      rawLines: [
        "Library ID: 1558831445668603",
        "Started running on 1 May 2026",
        "Progressive",
        "You read that right: Drivers who switch and save with Progressive save $946 on average!",
        "0:00 / 0:06",
        "Switch and you could save.",
        "Get Quote"
      ],
      buttons: ["Get Quote"],
      ctaButton: "Get Quote",
      categories: ["Properties"],
      images: ["https://img/1.jpg"]
    });

    expect(result.cta).toBe("Get Quote");
    expect(result.caption).toBe("Switch and you could save.");
    expect(result.caption).not.toBe("0:00 / 0:06");
  });

  it("should use raw headline when no structured ad-library fields are present", () => {
    const result = analyze({
      text: "Berkshire Hathaway HomeServices When you're ready to buy a home, you want a negotiator on your side. Our network agents have been honing that skill for years.",
      headline: "",
      company: "Berkshire Hathaway HomeServices",
      title: "Berkshire Hathaway HomeServices",
      body: "Berkshire Hathaway HomeServices When you're ready to buy a home, you want a negotiator on your side. Our network agents have been honing that skill for years.",
      caption: "Always by your side.",
      images: []
    });

    expect(result.hook).toBe(
      "Berkshire Hathaway HomeServices When you're ready to buy a home, you want a negotiator on your side."
    );
    expect(result.company).toBeNull();
  });

  it("should keep inline company prefix when fallback parsing uses raw text", () => {
    const result = analyze({
      text: "Progressive You read that right: Drivers who switch and save with Progressive save $946 on average!",
      headline: "",
      company: "Progressive",
      title: "Progressive",
      body: "Progressive You read that right: Drivers who switch and save with Progressive save $946 on average!",
      caption: "Switch and you could save.",
      images: []
    });

    expect(result.hook).toBe(
      "Progressive You read that right: Drivers who switch and save with Progressive save $946 on average!"
    );
  });

  it("should build hook from leading text when fallback parsing is used", () => {
    const result = analyze({
      text: "2 ads use this creative and text American Family Insurance Protect the dreams you've worked so hard to build. Simple, personalized, affordable car and home insurance designed with you in mind.",
      headline: "",
      company: "American Family Insurance",
      title: "American Family Insurance",
      body: "2 ads use this creative and text American Family Insurance Protect the dreams you've worked so hard to build. Simple, personalized, affordable car and home insurance designed with you in mind.",
      caption: "Simple, personalized, affordable car and home insurance designed with you in mind.",
      images: []
    });

    expect(result.hook).toBe(
      "2 ads use this creative and text American Family Insurance Protect the dreams you've worked so hard to build."
    );
  });

  it("should use main text as caption when it is the only remaining line near the CTA", () => {
    const result = analyze({
      text: "Library ID: 77 Started running on 1 May 2026 Brand Name Main ad text sentence here.",
      headline: "",
      rawLines: [
        "Library ID: 77",
        "Started running on 1 May 2026",
        "Brand Name",
        "Main ad text sentence here.",
        "Learn More"
      ],
      buttons: ["Learn More"],
      ctaButton: "Learn More",
      images: []
    });

    expect(result.caption).toBe("Main ad text sentence here.");
  });

  it("should parse russian started-running and ignore insight metadata in body", () => {
    const result = analyze({
      text: "Активно ID Библиотеки: 25966110033014507 Показ начат 5 янв 2026 г. Этот креатив и текст используются в 2 объявлениях Открыть раскрывающееся меню New York Life Insurance Company Every dream deserves a plan and the guidance to see it through.",
      headline: "",
      rawLines: [
        "Активно",
        "ID Библиотеки: 25966110033014507",
        "Показ начат 5 янв 2026 г.",
        "Этот креатив и текст используются в 2 объявлениях",
        "Открыть раскрывающееся меню",
        "New York Life Insurance Company",
        "Every dream deserves a plan and the guidance to see it through.",
        "Learn More"
      ],
      buttons: ["Learn More"],
      ctaButton: "Learn More",
      images: []
    });

    expect(result.startedRunning).toBe("Показ начат 5 янв 2026 г.");
    expect(result.body).toContain("Every dream deserves a plan and the guidance to see it through.");
    expect(result.body).not.toContain("ID Библиотеки");
    expect(result.body).not.toContain("Этот креатив и текст используются");
  });

  it("should drop leading service lines before real ad sentence", () => {
    const result = analyze({
      text: "",
      headline: "",
      rawLines: [
        "ID Библиотеки: 854033290992780",
        "Показ начат 2 мар 2026 г.",
        "Платформы",
        "Категории",
        "У этой рекламы несколько версий",
        "New York Life Insurance Company",
        "Реклама",
        "Big or small, you can trust New York Life to bring your dreams closer to reality.",
        "NEWYORKLIFE.COM",
        "Learn More"
      ],
      buttons: ["Learn More"],
      ctaButton: "Learn More",
      images: []
    });

    expect(result.body).toContain("Big or small, you can trust New York Life");
    expect(result.body).not.toContain("Платформы");
    expect(result.body).not.toContain("Категории");
    expect(result.body).not.toContain("несколько версий");
    expect(result.body).not.toContain("Реклама");
  });

  it("should exclude english meta lines from text body", () => {
    const result = analyze({
      text: "",
      headline: "",
      rawLines: [
        "Library ID: 1233962465345752",
        "The show started on January 20, 2026.",
        "Platforms",
        "Categories",
        "This advertisement has several versions.",
        "This creative and text are used in 2 ads.",
        "New York Life Insurance Company",
        "Advertising",
        "Contact an agent for strategies that protect you every step of the way.",
        "NEWYORKLIFE.COM",
        "Contact Us"
      ],
      buttons: ["Contact Us"],
      ctaButton: "Contact Us",
      images: []
    });

    expect(result.body).toContain("Contact an agent for strategies that protect you every step of the way.");
    expect(result.body).not.toContain("This advertisement has several versions");
    expect(result.body).not.toContain("This creative and text are used in 2 ads");
    expect(result.body).not.toContain("Advertising");
  });

});
