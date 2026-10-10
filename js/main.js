const DATA_PATH = "./data/leaderboard.json";
const TEAM_ORDER = ["7th Grade", "8th Grade"];
const TEAM_COLORS = {
  "7th Grade": { solid: "#1223b7", soft: "rgba(39, 198, 255, 0.18)" },
  "8th Grade": { solid: "#e10000", soft: "rgba(255, 141, 59, 0.18)" }
};

let chartHistory = [];
let chartAnimationFrame;
let refreshTimeoutId;
const counterAnimations = new WeakMap();

const formatNumber = (value) => new Intl.NumberFormat("en-US").format(value);

async function fetchLeaderboardData() {
  // Cache-busting keeps Pages/CDN responses fresh after JSON-only updates.
  const response = await fetch(`${DATA_PATH}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to load leaderboard data (${response.status})`);
  }

  return response.json();
}

function animateCounter(element, nextValue) {
  const startValue = Number(element.dataset.value || 0);
  const duration = 10000;
  const startTime = performance.now();
  const currentAnimation = counterAnimations.get(element);

  if (currentAnimation) {
    cancelAnimationFrame(currentAnimation);
  }

  const tick = (now) => {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const currentValue = Math.round(startValue + (nextValue - startValue) * eased);
    element.textContent = formatNumber(currentValue);

    if (progress < 1) {
      const nextAnimation = requestAnimationFrame(tick);
      counterAnimations.set(element, nextAnimation);
    } else {
      element.dataset.value = String(nextValue);
      counterAnimations.delete(element);
    }
  };

  const nextAnimation = requestAnimationFrame(tick);
  counterAnimations.set(element, nextAnimation);
}

function renderStandings(data) {
  const teams = [...data.teams].sort((left, right) => right.totalPoints - left.totalPoints);
  if (teams.length < 2) {
    throw new Error("Leaderboard data must contain both grade teams.");
  }
  const leader = teams[0];
  const runnerUp = teams[1];
  const differential = leader.totalPoints - runnerUp.totalPoints;

  TEAM_ORDER.forEach((grade) => {
    const team = data.teams.find((entry) => entry.grade === grade);
    if (!team) {
      return;
    }

    const totalElement = document.querySelector(`[data-total-for="${grade}"]`);
    //const rankElement = document.querySelector(`[data-rank-for="${grade}"]`);
    const cardElement = document.querySelector(`[data-team-card="${grade}"]`);
    if (!totalElement || !cardElement) {
      throw new Error(`Missing scoreboard elements for ${grade}.`);
    }
    //const rank = teams.findIndex((entry) => entry.grade === grade) + 1;

    totalElement.dataset.value ??= "0";
    animateCounter(totalElement, team.totalPoints);
    //rankElement.textContent = `#${rank}`;
    cardElement.classList.toggle("is-leading", grade === leader.grade);
  });

  /*const diffTotal = document.getElementById("diff-total");
  const diffMeta = document.getElementById("diff-meta");
  if (!diffTotal || !diffMeta) {
    throw new Error("Missing lead differential elements.");
  }

  diffTotal.dataset.value ??= "0";
  animateCounter(diffTotal, differential);
  diffMeta.textContent = `${leader.grade} leads by ${formatNumber(differential)} points`;*/
}

function renderStatus(lastUpdated) {
  const lastUpdatedElement = document.getElementById("last-updated");
  if (!lastUpdatedElement) {
    throw new Error("Missing last updated element.");
  }

  lastUpdatedElement.textContent = lastUpdated;
}

function renderChartSummary(data) {
  const summary = document.getElementById("chart-summary");
  if (!summary) {
    return;
  }

  const finalDay = data.history.at(-1)?.day ?? "the latest update";
  const seventh = data.teams.find((entry) => entry.grade === "(7th)")?.totalPoints ?? 0;
  const eighth = data.teams.find((entry) => entry.grade === "(8th)")?.totalPoints ?? 0;
  summary.textContent = `${finalDay}: 7th Grade has ${formatNumber(seventh)} points and 8th Grade has ${formatNumber(eighth)} points.`;
}

function renderStudentLeaderboard(entries) {
  const list = document.getElementById("student-leaderboard");
  if (!list) {
    throw new Error("Missing student leaderboard container.");
  }
  const topFive = [...entries]
    .sort((left, right) => right.totalPoints - left.totalPoints)
    .slice(0, 5);

  list.innerHTML = "";

  topFive.forEach((entry, index) => {
    const item = document.createElement("li");
    const rank = document.createElement("span");
    const details = document.createElement("span");
    const name = document.createElement("strong");
    const grade = document.createElement("span");
    const points = document.createElement("span");

    rank.className = "student-rank";
    rank.textContent = `${index + 1}. `;

    name.className = "student-name";
    name.textContent = entry.name;
    grade.textContent = ` ${entry.grade} `;
    details.append(name, grade);

    points.className = "student-points";
    points.textContent = formatNumber(entry.totalPoints);

    item.append(rank, details, points);
    list.appendChild(item);
  });
}

function drawEmptyChartState(ctx, canvas, message) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(Math.round(rect.width * dpr), 1);
  const height = Math.max(Math.round(rect.height * dpr), 1);

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
  ctx.font = '600 16px Inter, "Segoe UI", Arial, sans-serif';
  ctx.textAlign = "center";
  ctx.fillText(message, rect.width / 2, rect.height / 2);
}

function getChartPointSets(history, width, height, padding) {
  if (!history.length) {
    return [];
  }

  const maxValue = Math.max(...history.flatMap((entry) => [entry["7th"], entry["8th"]]), 0);
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  return TEAM_ORDER.map((grade) => {
    const key = grade.startsWith("7th") ? "7th" : "8th";
    return {
      grade,
      points: history.map((entry, index) => ({
        x: padding.left + (chartWidth * index) / Math.max(history.length - 1, 1),
        y: maxValue === 0
          ? padding.top + chartHeight
          : padding.top + chartHeight - (entry[key] / maxValue) * chartHeight,
        value: entry[key]
      }))
    };
  });
}

function drawSmoothLine(ctx, points, color, progress) {
  if (!points.length) {
    return;
  }

  const segmentProgress = progress * Math.max(points.length - 1, 1);
  const visibleSegments = Math.floor(segmentProgress);
  const partialProgress = segmentProgress - visibleSegments;
  const visiblePoints = points.slice(0, visibleSegments + 1);

  if (visiblePoints.length < points.length && points[visibleSegments + 1]) {
    const current = points[visibleSegments];
    const next = points[visibleSegments + 1];
    visiblePoints.push({
      x: current.x + (next.x - current.x) * partialProgress,
      y: current.y + (next.y - current.y) * partialProgress
    });
  }

  ctx.beginPath();
  ctx.moveTo(visiblePoints[0].x, visiblePoints[0].y);

  for (let index = 0; index < visiblePoints.length - 1; index += 1) {
    const current = visiblePoints[index];
    const next = visiblePoints[index + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    ctx.lineTo(current.x, current.y, midX, midY);
  }

  const lastPoint = visiblePoints[visiblePoints.length - 1];
  ctx.lineTo(lastPoint.x, lastPoint.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();

  visiblePoints.forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  });
}

function drawChartFrame(ctx, canvas, history, progress) {
  if (!history.length) {
    drawEmptyChartState(ctx, canvas, "Waiting for progress history");
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(Math.round(rect.width * dpr), 1);
  const height = Math.max(Math.round(rect.height * dpr), 1);
  const padding = { top: 24, right: 16, bottom: 38, left: 52 };

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  const cssWidth = rect.width;
  const cssHeight = rect.height;
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const chartWidth = cssWidth - padding.left - padding.right;
  const chartHeight = cssHeight - padding.top - padding.bottom;
  const maxValue = Math.max(...history.flatMap((entry) => [entry["7th"], entry["8th"]]), 0);
  const pointSets = getChartPointSets(history, cssWidth, cssHeight, padding);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.fillStyle = "#d7e5f4";
  ctx.font = '12px Inter, "Segoe UI", Arial, sans-serif';

  for (let step = 0; step <= 4; step += 1) {
    const y = padding.top + (chartHeight * step) / 4;
    const value = Math.round(maxValue - (maxValue * step) / 4);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + chartWidth, y);
    ctx.stroke();
    ctx.fillText(formatNumber(value), 8, y + 4);
  }

  history.forEach((entry, index) => {
    const x = padding.left + (chartWidth * index) / Math.max(history.length - 1, 1);
    const textWidth = ctx.measureText(entry.day).width;
    const labelX = Math.min(
      Math.max(x - textWidth / 2, padding.left),
      padding.left + chartWidth - textWidth
    );
    ctx.fillText(entry.day, labelX, cssHeight - 10);
  });

  pointSets.forEach(({ grade, points }) => {
    drawSmoothLine(ctx, points, TEAM_COLORS[grade].solid, progress);
  });
}

function renderChart(history) {
  const canvas = document.getElementById("history-chart");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("History chart canvas is missing.");
  }
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is unavailable.");
  }
  const duration = 10000;
  const start = performance.now();

  chartHistory = history;
  cancelAnimationFrame(chartAnimationFrame);

  if (!history.length) {
    drawEmptyChartState(context, canvas, "Waiting for progress history");
    return;
  }

  const animate = (timestamp) => {
    const progress = Math.min((timestamp - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    drawChartFrame(context, canvas, history, eased);

    if (progress < 1) {
      chartAnimationFrame = requestAnimationFrame(animate);
    }
  };

  chartAnimationFrame = requestAnimationFrame(animate);
}

function validateDataShape(data) {
  if (!data || !Array.isArray(data.teams) || !Array.isArray(data.history) || !Array.isArray(data.leaderboard)) {
    throw new Error("Leaderboard data is missing one or more required arrays.");
  }
}

async function loadLeaderboard() {
  try {
    const data = await fetchLeaderboardData();
    validateDataShape(data);
    renderStandings(data);
    //renderChart(data.history);
    //renderChartSummary(data);
    renderStudentLeaderboard(data.leaderboard);
    renderStatus(data.lastUpdated);
  } catch (error) {
    console.error(error);
    const diffMeta = document.getElementById("diff-meta");
    const lastUpdated = document.getElementById("last-updated");

    if (diffMeta) {
      diffMeta.textContent = "Unable to load latest leaderboard data.";
    }

    if (lastUpdated) {
      lastUpdated.textContent = "Unavailable";
    }
  }
}

async function scheduleRefresh() {
  clearTimeout(refreshTimeoutId);
  refreshTimeoutId = window.setTimeout(async () => {
    console.log("refreshing leaderboard data...");
    await loadLeaderboard();
    await scheduleRefresh();
  }, 20000);
}

/*window.addEventListener("resize", () => {
  if (chartHistory.length) {
    const canvas = document.getElementById("history-chart");
    if (!(canvas instanceof HTMLCanvasElement)) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    drawChartFrame(context, canvas, chartHistory, 1);
  }
});*/

window.addEventListener("DOMContentLoaded", async () => {
  await loadLeaderboard();
  await scheduleRefresh();
});
