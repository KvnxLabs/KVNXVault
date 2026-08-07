"use strict";

// The mission catalog is intentionally data-driven so a future AI service can
// replace generateMission() without changing the dashboard rendering layer.
window.KVNXMissionEngine = (() => {
  let fallbackInstanceSequence = 0;

  const missionCatalog = {
  career: {
    templateId: "career-focused-session",
    title: "Advance Your Career",
    description: "Complete one focused action that moves your career forward today.",
    estimatedDuration: "30 minutes",
  },
  business: {
    templateId: "business-focused-session",
    title: "Build Your Business",
    description: "Spend 30 focused minutes working on the next meaningful business priority.",
    estimatedDuration: "30 minutes",
  },
  programming: {
    templateId: "programming-focused-session",
    title: "Complete a Coding Session",
    description: "Complete one focused coding session today without switching tasks.",
    estimatedDuration: "30 minutes",
  },
  fitness: {
    templateId: "fitness-focused-session",
    title: "Move With Intention",
    description: "Complete a 20-minute workout or purposeful movement session.",
    estimatedDuration: "20 minutes",
  },
  health: {
    templateId: "health-focused-session",
    title: "Invest in Your Health",
    description: "Complete one deliberate action that supports your physical well-being.",
    estimatedDuration: "20 minutes",
  },
  learning: {
    templateId: "learning-focused-session",
    title: "Complete a Learning Session",
    description: "Study one focused topic and capture the most important lesson.",
    estimatedDuration: "30 minutes",
  },
  reading: {
    templateId: "reading-focused-session",
    title: "Read With Focus",
    description: "Read without distraction and capture one idea worth remembering.",
    estimatedDuration: "20 minutes",
  },
  creativity: {
    templateId: "creativity-focused-session",
    title: "Create Something Today",
    description: "Complete one uninterrupted creative session and leave with something tangible.",
    estimatedDuration: "30 minutes",
  },
  finance: {
    templateId: "finance-focused-session",
    title: "Review Your Finances",
    description: "Review your current finances and identify one clear next action.",
    estimatedDuration: "20 minutes",
  },
  relationships: {
    templateId: "relationships-focused-session",
    title: "Strengthen a Relationship",
    description: "Reach out to someone important and give the conversation your full attention.",
    estimatedDuration: "15 minutes",
  },
  mindset: {
    templateId: "mindset-focused-session",
    title: "Reflect With Honesty",
    description: "Journal for 10 minutes about what is helping or limiting your progress.",
    estimatedDuration: "10 minutes",
  },
  };

  const difficultyByIntensity = {
    balanced: "Balanced",
    focused: "Focused",
    relentless: "Challenging",
  };

  const normalizeKey = (value) => String(value || "").trim().toLowerCase();
  const createTemplateKey = (value) => normalizeKey(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "general";

  const createBrowserUUID = () => {
    const cryptoApi = globalThis.crypto;
    if (typeof cryptoApi?.randomUUID === "function") {
      return cryptoApi.randomUUID();
    }

    if (typeof cryptoApi?.getRandomValues === "function") {
      const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
      return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
    }

    // Last-resort uniqueness for older/non-browser test environments. This is
    // deliberately monotonic rather than pretending weak randomness is secure.
    fallbackInstanceSequence += 1;
    return `${Date.now().toString(36)}-${fallbackInstanceSequence.toString(36)}`;
  };

  const createFallbackMission = (focus) => ({
    templateId: `${createTemplateKey(focus)}-focused-session`,
    title: focus ? `Make Progress in ${focus}` : "Build Focused Momentum",
    description: focus
      ? `Complete one intentional work session that moves your ${focus.toLowerCase()} journey forward.`
      : "Complete one intentional work session toward the direction you chose.",
    estimatedDuration: "30 minutes",
  });

  const generateMission = async (onboardingAnswers = {}) => {
    const primaryFocus = String(onboardingAnswers.primaryFocus || "").trim();
    const template = missionCatalog[normalizeKey(primaryFocus)] || createFallbackMission(primaryFocus);

    return {
      id: `${template.templateId}-${createBrowserUUID()}`,
      focus: primaryFocus || "Personal Growth",
      title: template.title,
      description: template.description,
      estimatedDuration: template.estimatedDuration,
      difficulty: difficultyByIntensity[normalizeKey(onboardingAnswers.intensity)] || "Balanced",
      xpReward: 25,
    };
  };

  return { generateMission };
})();
