"use strict";

document.documentElement.classList.add("js");

document.addEventListener("DOMContentLoaded", () => {
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const header = document.querySelector(".header");
  const revealElements = document.querySelectorAll(".reveal");
  const progression = document.querySelector("[data-progression]");
  const progressionSteps = document.querySelectorAll("[data-progress-step]");
  const vaultVisual = document.querySelector("[data-vault-visual]");
  const navLinks = [...document.querySelectorAll("[data-section-nav] a")];

  // Condense the navigation only after the hero begins leaving the viewport.
  let headerUpdatePending = false;

  const updateHeader = () => {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 36);
    headerUpdatePending = false;
  };

  const requestHeaderUpdate = () => {
    if (headerUpdatePending) return;
    headerUpdatePending = true;
    window.requestAnimationFrame(updateHeader);
  };

  updateHeader();
  window.addEventListener("scroll", requestHeaderUpdate, { passive: true });

  // Keep the experience fully readable when motion is reduced or unsupported.
  if (reducedMotion || !("IntersectionObserver" in window)) {
    revealElements.forEach((element) => element.classList.add("is-visible"));
    progressionSteps.forEach((step) => step.classList.add("is-active"));
    progression?.querySelector(".path")?.classList.add("is-active");
  } else {
    const revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -44px" },
    );

    revealElements.forEach((element) => revealObserver.observe(element));

    if (progression) {
      const progressionObserver = new IntersectionObserver(
        (entries, observer) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;

            progression.querySelector(".path")?.classList.add("is-active");
            progressionSteps.forEach((step, index) => {
              window.setTimeout(() => {
                step.classList.add("is-active");
              }, index * 150);
            });

            observer.unobserve(entry.target);
          });
        },
        { threshold: 0.28 },
      );

      progressionObserver.observe(progression);
    }

  }

  // Keep section context accurate even when motion preferences disable reveals.
  if (navLinks.length && "IntersectionObserver" in window) {
    const activeSections = new Map();
    const sectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            activeSections.set(entry.target, entry.intersectionRatio);
          } else {
            activeSections.delete(entry.target);
          }
        });

        const currentSection = [...activeSections.entries()].sort(
          (a, b) => b[1] - a[1],
        )[0]?.[0];

        if (!currentSection) return;

        const currentKey = currentSection.dataset.navKey;
        navLinks.forEach((link) => {
          if (link.dataset.navKey === currentKey) {
            link.setAttribute("aria-current", "location");
          } else {
            link.removeAttribute("aria-current");
          }
        });
      },
      { rootMargin: "-28% 0px -58%", threshold: [0, 0.12, 0.3, 0.6] },
    );

    document.querySelectorAll("[data-section]").forEach((section) => {
      sectionObserver.observe(section);
    });
  }

  // Add a restrained pointer response to the vault on precise pointing devices.
  if (
    vaultVisual &&
    !reducedMotion &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches
  ) {
    const resetVaultPosition = () => {
      vaultVisual.style.setProperty("--vault-rotate-x", "0deg");
      vaultVisual.style.setProperty("--vault-rotate-y", "0deg");
    };

    vaultVisual.addEventListener("pointermove", (event) => {
      const bounds = vaultVisual.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - 0.5;
      const y = (event.clientY - bounds.top) / bounds.height - 0.5;

      vaultVisual.style.setProperty("--vault-rotate-x", `${-y * 4}deg`);
      vaultVisual.style.setProperty("--vault-rotate-y", `${x * 4}deg`);
    });

    vaultVisual.addEventListener("pointerleave", resetVaultPosition);
  }

  document.querySelectorAll("[data-year]").forEach((year) => {
    year.textContent = new Date().getFullYear();
  });
});
