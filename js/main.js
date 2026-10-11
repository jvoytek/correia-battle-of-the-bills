const DATA_PATH = "./data/leaderboard.json";
const TEAM_ORDER = ["7th Grade", "8th Grade"];
const DAILY_ANIMATION_SPEED = 19 / 20;
const DAILY_ANIMATION_PAUSE_MS = 1000;
const TEAM_COLORS = {
  "7th Grade": { solid: "#1223b7", soft: "rgba(39, 198, 255, 0.18)" },
  "8th Grade": { solid: "#e10000", soft: "rgba(255, 141, 59, 0.18)" }
};

let chartHistory = [];
let chartAnimationFrame;
let dailyAnimationFrame;
let refreshTimeoutId;
let lastDataSignature;
const leaderboardNodes = new Map();
let leaderboardOrder = "";

const formatNumber = (value) => new Intl.NumberFormat("en-US").format(value);

async function fetchLeaderboardData() {
  // Cache-busting keeps Pages/CDN responses fresh after JSON-only updates.
  const response = await fetch(`${DATA_PATH}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to load leaderboard data (${response.status})`);
  }

  return response.json();
}

function renderStandings(teams) {
  const orderedTeams = [...teams].sort((left, right) => right.totalPoints - left.totalPoints);
  if (orderedTeams.length < 2) {
    throw new Error("Leaderboard data must contain both grade teams.");
  }
  const leader = orderedTeams[0];

  TEAM_ORDER.forEach((grade) => {
    const team = teams.find((entry) => entry.grade === grade);
    if (!team) {
      return;
    }

    const totalElement = document.querySelector(`[data-total-for="${grade}"]`);
    //const rankElement = document.querySelector(`[data-rank-for="${grade}"]`);
    const cardElement = document.querySelector(`[data-team-card="${grade}"]`);
    if (!totalElement || !cardElement) {
      throw new Error(`Missing scoreboard elements for ${grade}.`);
    }

    totalElement.textContent = formatNumber(team.totalPoints);
    cardElement.classList.toggle("is-leading", grade === leader.grade);
  });
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

  const nextOrder = topFive.map((entry) => `${entry.name}|${entry.grade}`).join("\n");
  topFive.forEach((entry, index) => {
    const key = `${entry.name}|${entry.grade}`;
    let row = leaderboardNodes.get(key);
    if (!row) {
      const item = document.createElement("li");
      const rank = document.createElement("span");
      const details = document.createElement("span");
      const name = document.createElement("strong");
      const grade = document.createElement("span");
      const points = document.createElement("span");

      rank.className = "student-rank";
      name.className = "student-name";
      name.textContent = entry.name;
      grade.textContent = ` ${entry.grade} `;
      details.append(name, grade);
      points.className = "student-points";
      item.append(rank, details, points);
      row = { item, rank, points };
      leaderboardNodes.set(key, row);
    }

    row.rank.textContent = `${index + 1}. `;
    row.points.textContent = formatNumber(entry.totalPoints);
  });

  if (nextOrder !== leaderboardOrder) {
    list.replaceChildren(...topFive.map((entry) => leaderboardNodes.get(`${entry.name}|${entry.grade}`).item));
    leaderboardOrder = nextOrder;
  }
}

function renderDailyHistory(data) {
  const dayNumber = document.getElementById("day-number");
  if (!dayNumber) {
    throw new Error("Missing day number display.");
  }

  const start = performance.now();
  const historyLength = data.history.length;
  let lastDayIndex = -1;
  const update = (timestamp) => {
    const intervalDuration = 1000 / DAILY_ANIMATION_SPEED;
    const cycleDuration = intervalDuration + DAILY_ANIMATION_PAUSE_MS;
    const elapsed = timestamp - start;
    const intervalIndex = historyLength === 1
      ? 0
      : Math.min(Math.floor(elapsed / cycleDuration), historyLength - 2);
    const intervalElapsed = elapsed - intervalIndex * cycleDuration;
    const progress = Math.min(intervalElapsed / intervalDuration, 1);
    const isFinished = historyLength === 1 ||
      elapsed >= (historyLength - 2) * cycleDuration + intervalDuration;
    const dayIndex = isFinished
      ? historyLength - 1
      : Math.min(intervalIndex + (intervalElapsed >= intervalDuration ? 1 : 0), historyLength - 1);

    if (dayIndex !== lastDayIndex) {
      dayNumber.textContent = `Day ${data.history[dayIndex].day}`;
      lastDayIndex = dayIndex;
    }

    const teams = data.teams.map((team) => {
      const history = data.historyByTeam[team.grade];
      const values = { grade: team.grade };
      const suffix = team.grade.startsWith("7th") ? "7th" : "8th";
      ["totalPoints", "online", "pennies", "bonus", "sabotage"].forEach((field) => {
        const from = history[field][intervalIndex];
        const to = history[field][Math.min(intervalIndex + 1, history[field].length - 1)];
        const value = Math.round(from + (to - from) * progress);
        values[field] = value;
        const element = document.getElementById(`${field === "totalPoints" ? "total" : field}-${suffix}`);
        if (!element) {
          throw new Error(`Missing ${field} points element for ${team.grade}.`);
        }
        element.textContent = formatNumber(value);
      });
      return values;
    });

    renderStandings(teams);

    if (!isFinished) {
      dailyAnimationFrame = requestAnimationFrame(update);
    } else {
      dailyAnimationFrame = undefined;
    }
  };

  cancelAnimationFrame(dailyAnimationFrame);
  dailyAnimationFrame = requestAnimationFrame(update);
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
  if (
    !data ||
    !Array.isArray(data.teams) ||
    !Array.isArray(data.history) ||
    !data.history.length ||
    !data.historyByTeam ||
    !Array.isArray(data.leaderboard)
  ) {
    throw new Error("Leaderboard data is missing one or more required arrays.");
  }

  const metrics = ["totalPoints", "online", "pennies", "bonus", "sabotage"];
  data.teams.forEach((team) => {
    const history = data.historyByTeam[team.grade];
    if (!history || metrics.some((metric) => (
      !Array.isArray(history[metric]) ||
      history[metric].length !== data.history.length ||
      history[metric].some((value) => !Number.isInteger(value))
    ))) {
      throw new Error(`Invalid daily points history for ${team.grade}.`);
    }
    if (history.totalPoints.at(-1) !== team.totalPoints) {
      throw new Error(`Latest points history does not match ${team.grade}.`);
    }
  });

  if (!Array.isArray(data.leaderboard) || data.leaderboard.some((leader) => (
    typeof leader.name !== "string" ||
    typeof leader.grade !== "string" ||
    !Number.isInteger(leader.totalPoints)
  ))) {
    throw new Error("Invalid current leaderboard.");
  }
}

async function loadLeaderboard() {
  try {
    const data = await fetchLeaderboardData();
    validateDataShape(data);
    const signature = JSON.stringify(data);
    if (signature !== lastDataSignature) {
      renderDailyHistory(data);
      renderStudentLeaderboard(data.leaderboard);
      lastDataSignature = signature;
    }
    //renderChart(data.history);
    //renderChartSummary(data);
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
