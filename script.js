"use strict";

document.documentElement.classList.add("js");

document.addEventListener("DOMContentLoaded", () => {
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  const header = document.querySelector(".site-header, .header");
  const revealElements = document.querySelectorAll("[data-reveal]");
  const progressionSteps = document.querySelectorAll(
    "[data-progress-step], .progression__step",
  );
  const vaultVisual = document.querySelector(
    "[data-vault-visual], .vault-visual",
  );

  const updateHeader = () => {
    if (!header) return;

    const isScrolled = window.scrollY > 24;

    header.classList.toggle("is-scrolled", isScrolled);
    header.classList.toggle("site-header--scrolled", isScrolled);
  };

  updateHeader();

  window.addEventListener("scroll", updateHeader, {
    passive: true,
  });

  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const targetId = link.getAttribute("href");

      if (!targetId || targetId === "#") return;

      const target = document.querySelector(targetId);

      if (!target) return;

      event.preventDefault();

      target.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "start",
      });

      history.pushState(null, "", targetId);
    });
  });

  if (reducedMotion || !("IntersectionObserver" in window)) {
    revealElements.forEach((element) => {
      element.classList.add("is-visible");
    });

    progressionSteps.forEach((step) => {
      step.classList.add("is-active");
    });
  } else {
    const revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      {
        threshold: 0.16,
        rootMargin: "0px 0px -48px",
      },
    );

    revealElements.forEach((element) => {
      revealObserver.observe(element);
    });

    const progressionObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          progressionSteps.forEach((step, index) => {
            window.setTimeout(() => {
              step.classList.add("is-active");
            }, index * 160);
          });

          observer.unobserve(entry.target);
        });
      },
      {
        threshold: 0.3,
      },
    );

    const progression = document.querySelector(
      "[data-progression], .progression",
    );

    if (progression) {
      progressionObserver.observe(progression);
    }
  }

  if (vaultVisual && !reducedMotion) {
    const resetVaultPosition = () => {
      vaultVisual.style.setProperty("--vault-rotate-x", "0deg");
      vaultVisual.style.setProperty("--vault-rotate-y", "0deg");
    };

    vaultVisual.addEventListener("pointermove", (event) => {
      const bounds = vaultVisual.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - 0.5;
      const y = (event.clientY - bounds.top) / bounds.height - 0.5;

      vaultVisual.style.setProperty(
        "--vault-rotate-x",
        `${-y * 5}deg`,
      );

      vaultVisual.style.setProperty(
        "--vault-rotate-y",
        `${x * 5}deg`,
      );
    });

    vaultVisual.addEventListener(
      "pointerleave",
      resetVaultPosition,
    );
  }
});
