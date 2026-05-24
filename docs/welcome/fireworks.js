(() => {
  const canvas = document.getElementById("fireworks");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!canvas || reduceMotion) return;

  const ctx = canvas.getContext("2d");
  const colors = ["#2563eb", "#ef233c", "#fbbf24", "#22c55e"];
  const particles = [];
  let width = 0;
  let height = 0;
  let animationId = 0;

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function burst(x, y) {
    const count = 38;
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count;
      const speed = 1.8 + Math.random() * 3.2;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 46 + Math.random() * 20,
        maxLife: 66,
        size: 2 + Math.random() * 2.6,
        color: colors[Math.floor(Math.random() * colors.length)]
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.035;
      p.life -= 1;

      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }

      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    if (particles.length > 0) {
      animationId = requestAnimationFrame(draw);
    }
  }

  function launch() {
    resize();
    const points = [
      [width * 0.22, height * 0.24],
      [width * 0.78, height * 0.22],
      [width * 0.5, height * 0.16],
      [width * 0.32, height * 0.42],
      [width * 0.68, height * 0.42]
    ];

    points.forEach(([x, y], index) => {
      window.setTimeout(() => {
        burst(x, y);
        cancelAnimationFrame(animationId);
        draw();
      }, index * 280);
    });
  }

  window.addEventListener("resize", resize);
  window.addEventListener("load", launch);
})();
