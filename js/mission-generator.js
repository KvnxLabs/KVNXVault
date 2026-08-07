"use strict";

// The mission catalog is intentionally data-driven so a future AI service can
// replace generateMission() without changing the dashboard rendering layer.
window.KVNXMissionEngine = (() => {
  const missionCatalog = {
  career: {
    title: "Advance Your Career",
    description: "Complete one focused action that moves your career forward today.",
    estimatedDuration: "30 minutes",
  },
  business: {
    title: "Build Your Business",
    description: "Spend 30 focused minutes working on the next meaningful business priority.",
    estimatedDuration: "30 minutes",
  },
  programming: {
    title: "Complete a Coding Session",
    description: "Complete one focused coding session today without switching tasks.",
    estimatedDuration: "30 minutes",
  },
  fitness: {
    title: "Move With Intention",
    description: "Complete a 20-minute workout or purposeful movement session.",
    estimatedDuration: "20 minutes",
  },
  health: {
    title: "Invest in Your Health",
    description: "Complete one deliberate action that supports your physical well-being.",
    estimatedDuration: "20 minutes",
  },
  learning: {
    title: "Complete a Learning Session",
    description: "Study one focused topic and capture the most important lesson.",
    estimatedDuration: "30 minutes",
  },
  reading: {
    title: "Read With Focus",
    description: "Read without distraction and capture one idea worth remembering.",
    estimatedDuration: "20 minutes",
  },
  creativity: {
    title: "Create Something Today",
    description: "Complete one uninterrupted creative session and leave with something tangible.",
    estimatedDuration: "30 minutes",
  },
  finance: {
    title: "Review Your Finances",
    description: "Review your current finances and identify one clear next action.",
    estimatedDuration: "20 minutes",
  },
  relationships: {
    title: "Strengthen a Relationship",
    description: "Reach out to someone important and give the conversation your full attention.",
    estimatedDuration: "15 minutes",
  },
  mindset: {
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

  const createFallbackMission = (focus) => ({
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
      id: `first-mission-${normalizeKey(primaryFocus) || "general"}`,
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
