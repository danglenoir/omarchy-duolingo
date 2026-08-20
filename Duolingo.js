#!/usr/bin/env node
/**
 * Fetch and normalize Duolingo profile data for the Omarchy widget.
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const os = require('node:os');
const { parseArgs } = require('node:util');

const PUBLIC_USER_URL = "https://www.duolingo.com/2017-06-30/users";
const LEADERBOARD_URL = "https://duolingo-leaderboards-prod.duolingo.com/leaderboards/7d9f5dd1-8423-491a-91f2-2532052038ce/users/";
const ALLOWED_HOSTS = new Set([
  "www.duolingo.com",
  "duolingo-leaderboards-prod.duolingo.com",
]);
const LEAGUES = [
  "Bronze",
  "Silver",
  "Gold",
  "Sapphire",
  "Ruby",
  "Emerald",
  "Amethyst",
  "Pearl",
  "Obsidian",
  "Diamond"
];
const USER_AGENT = "Omarchy-Duolingo/1.0";
const MAX_DISPLAY_LENGTH = 200;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_COURSES = 256;
const MAX_RANKINGS = 512;
const MAX_USERNAME_LENGTH = 64;

class WidgetError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "WidgetError";
  }
}

function isAllowedUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && ALLOWED_HOSTS.has(parsed.hostname);
  } catch (err) {
    return false;
  }
}

function getJson(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    if (!isAllowedUrl(url)) {
      reject(new WidgetError("invalid_response", "Duolingo returned an unexpected response."));
      return;
    }

    const req = https.get(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
      },
      timeout: timeoutMs,
    }, (res) => {
      if (res.statusCode === 401 || res.statusCode === 403) {
        res.resume();
        reject(new WidgetError("authentication_failed", "Duolingo rejected the request."));
        return;
      }
      if (res.statusCode === 404) {
        res.resume();
        reject(new WidgetError("not_found", "Duolingo could not find that resource."));
        return;
      }
      if (res.statusCode === 429) {
        res.resume();
        reject(new WidgetError("rate_limited", "Duolingo is rate-limiting requests. Try again later."));
        return;
      }
      if (res.statusCode >= 300) {
        res.resume();
        reject(new WidgetError("api_error", `Duolingo returned HTTP ${res.statusCode}.`));
        return;
      }

      const contentLength = parseInt(res.headers["content-length"], 10);
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
        res.resume();
        reject(new WidgetError("invalid_response", "Duolingo returned an unexpected response."));
        return;
      }

      let payload = "";
      let rejected = false;
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        if (rejected) return;
        payload += chunk;
        if (payload.length > MAX_RESPONSE_BYTES) {
          rejected = true;
          res.destroy();
          reject(new WidgetError("invalid_response", "Duolingo returned an unexpected response."));
        }
      });
      res.on("end", () => {
        if (rejected) return;
        try {
          const data = JSON.parse(payload);
          if (typeof data !== "object" || data === null || Array.isArray(data)) {
            reject(new WidgetError("invalid_response", "Duolingo returned an unexpected response."));
            return;
          }
          resolve(data);
        } catch (err) {
          reject(new WidgetError("invalid_response", "Duolingo returned an unreadable response."));
        }
      });
    });

    req.on("error", (err) => {
      reject(new WidgetError("network_error", "Could not reach Duolingo."));
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new WidgetError("network_error", "Request to Duolingo timed out."));
    });
  });
}

function asInt(value) {
  if (value === null || value === undefined || typeof value === "boolean") {
    return null;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? null : parsed;
}

function nested(data, ...keys) {
  let current = data;
  for (const key of keys) {
    if (typeof current !== "object" || current === null || !(key in current)) {
      return null;
    }
    current = current[key];
  }
  return current;
}

function firstInt(...values) {
  for (const value of values) {
    const parsed = asInt(value);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function displayText(...values) {
  const text = firstText(...values)
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "");
  return text.length > MAX_DISPLAY_LENGTH ? text.substring(0, MAX_DISPLAY_LENGTH) : text;
}

function sanitizeField(obj, key) {
  if (!obj || !Object.prototype.hasOwnProperty.call(obj, key) || obj[key] == null) {
    return;
  }
  obj[key] = displayText(obj[key]);
}

function sanitizeSnapshot(data) {
  if (typeof data !== "object" || data === null) {
    return data;
  }

  if (data.profile && typeof data.profile === "object") {
    sanitizeField(data.profile, "name");
    sanitizeField(data.profile, "username");
  }

  if (data.course && typeof data.course === "object") {
    sanitizeField(data.course, "id");
    sanitizeField(data.course, "language");
    sanitizeField(data.course, "title");
  }

  if (data.leaderboard && typeof data.leaderboard === "object") {
    sanitizeField(data.leaderboard, "league");
  }

  sanitizeField(data, "error");

  if (Array.isArray(data.warnings)) {
    for (const warning of data.warnings) {
      if (typeof warning !== "object" || warning === null) continue;
      sanitizeField(warning, "code");
      sanitizeField(warning, "message");
    }
  }

  return data;
}

function parseIsoDate(value) {
  const text = String(value || "").trim().substring(0, 10);
  if (!text) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parts = text.split("-").map(Number);
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  return null;
}

function chooseCourse(profile, config) {
  const courses = Array.isArray(profile.courses)
    ? profile.courses.filter(c => typeof c === "object" && c !== null).slice(0, MAX_COURSES)
    : [];
  const current = profile.currentCourse;
  if (typeof current === "object" && current !== null) {
    if (!courses.some(course => course.id === current.id)) {
      courses.unshift(current);
    }
  }

  const courseId = firstText(config.courseId, config.course_id);
  const language = firstText(config.language, config.course).toLowerCase();
  const currentId = firstText(profile.currentCourseId, nested(current, "id"));
  const learningLanguage = firstText(profile.learningLanguage, nested(current, "learningLanguage")).toLowerCase();

  let selected = null;
  if (courseId) {
    selected = courses.find(course => String(course.id || "") === courseId) || null;
  }
  if (selected === null && language) {
    selected = courses.find(course => String(course.learningLanguage || "").toLowerCase() === language) || null;
  }
  if (selected === null && currentId) {
    selected = courses.find(course => String(course.id || "") === currentId) || null;
  }
  if (selected === null && learningLanguage) {
    selected = courses.find(course => String(course.learningLanguage || "").toLowerCase() === learningLanguage) || null;
  }
  if (selected === null && courses.length > 0) {
    selected = courses.reduce((max, course) => {
      const xp = asInt(course.xp) || 0;
      const maxXp = asInt(max.xp) || 0;
      return xp > maxXp ? course : max;
    }, courses[0]);
  }

  selected = selected || {};
  const code = firstText(selected.learningLanguage, language, learningLanguage);
  const title = displayText(selected.title, code ? code.toUpperCase() : "Current course");
  return {
    id: firstText(selected.id, courseId),
    language: code,
    title: title,
    xp: asInt(selected.xp),
  };
}

function normalizeStreak(profile, today) {
  let current = nested(profile, "streakData", "currentStreak");
  if (typeof current !== "object" || current === null) {
    current = {};
  }
  const days = firstInt(current.length, profile.streak, 0) || 0;
  const endDate = parseIsoDate(current.endDate);
  
  let todayDone = false;
  if (endDate !== null) {
    todayDone = endDate.getTime() >= today.getTime();
  }
  
  return {
    days: Math.max(0, days),
    lastDate: endDate ? endDate.toISOString().substring(0, 10) : "",
    todayDone: todayDone,
    atRisk: days > 0 && !todayDone,
  };
}

function normalizeLeaderboard(raw, userId) {
  const data = typeof raw === "object" && raw !== null ? raw : {};
  const board = typeof data.leaderboard === "object" && data.leaderboard !== null ? data.leaderboard : data;
  const active = typeof board.active === "object" && board.active !== null ? board.active : null;
  const cohort = active && typeof active.cohort === "object" && active.cohort !== null ? active.cohort : {};
  const tier = firstInt(cohort.tier, active ? active.tier : null, board.tier, data.tier);
  const league = tier !== null && tier >= 0 && tier < LEAGUES.length ? LEAGUES[tier] : "Unranked";

  const rankings = Array.isArray(cohort.rankings) ? cohort.rankings.slice(0, MAX_RANKINGS) : [];
  let standing = null;
  let position = null;
  for (let i = 0; i < rankings.length; i++) {
    const row = rankings[i];
    if (typeof row !== "object" || row === null) continue;
    const rowUserId = firstInt(row.user_id, row.userId);
    if (userId !== null && rowUserId === userId) {
      standing = row;
      position = i + 1;
      break;
    }
  }

  if (standing === null && active) {
    const activeUserId = firstInt(active.user_id, active.userId);
    if (userId !== null && activeUserId === userId) {
      standing = active;
      const rawRank = firstInt(active.rank);
      if (rawRank !== null) {
        position = rawRank + 1;
      }
    }
  }

  const score = firstInt(
    standing ? standing.score : null,
    active ? active.score : null
  );

  return {
    league: league,
    tier: tier,
    position: position,
    score: score,
    active: active !== null,
  };
}

function normalizeStats(profile, leaderboard, config, today = null, warnings = null) {
  const userId = asInt(profile.id);
  const todayDate = today || new Date();
  const todayZero = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate());
  const course = chooseCourse(profile, config);

  return sanitizeSnapshot({
    ok: true,
    configured: true,
    stale: false,
    error: "",
    errorCode: "",
    fetchedAt: new Date().toISOString(),
    profile: {
      id: userId,
      name: displayText(profile.name, profile.username, config.username),
      username: displayText(profile.username, config.username),
    },
    course: course,
    streak: normalizeStreak(profile, todayZero),
    courseXp: course.xp,
    totalXp: asInt(profile.totalXp),
    leaderboard: normalizeLeaderboard(leaderboard, userId),
    warnings: Array.isArray(warnings) ? warnings : [],
  });
}

function defaultCachePath() {
  const home = os.homedir();
  const cacheHome = process.env.XDG_CACHE_HOME || path.join(home, ".cache");
  return path.join(cacheHome, "omarchy-duolingo", "stats.json");
}

function configIdentity(config) {
  return [
    firstText(config.username).toLowerCase(),
    firstText(config.courseId, config.course_id).toLowerCase(),
    firstText(config.language, config.course).toLowerCase(),
  ].join("|");
}

function loadCache(cachePath, identity, maxAge = null) {
  try {
    const raw = fs.readFileSync(cachePath, "utf8");
    const wrapper = JSON.parse(raw);
    if (typeof wrapper !== "object" || wrapper === null || wrapper.identity !== identity) {
      return null;
    }
    const savedAt = parseFloat(wrapper.savedAt || 0);
    if (maxAge !== null && (Date.now() / 1000) - savedAt > maxAge) {
      return null;
    }
    const data = wrapper.data;
    return typeof data === "object" && data !== null && data.ok === true
      ? sanitizeSnapshot(data)
      : null;
  } catch (err) {
    return null;
  }
}

function saveCache(cachePath, identity, data) {
  const dir = path.dirname(cachePath);
  fs.mkdirSync(dir, { recursive: true });
  const wrapper = {
    identity: identity,
    savedAt: Date.now() / 1000,
    data: sanitizeSnapshot(data),
  };

  const tempPath = path.join(dir, `.stats-${Math.random().toString(36).substring(2)}.json`);
  try {
    fs.writeFileSync(tempPath, JSON.stringify(wrapper), "utf8");
    fs.chmodSync(tempPath, 0o600);
    fs.renameSync(tempPath, cachePath);
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (_) {}
    throw err;
  }
}

async function fetchStats(config, getJsonFn = getJson, timeoutMs = 12000) {
  const username = firstText(config.username);
  const warnings = [];
  if (!username || username.length > MAX_USERNAME_LENGTH) {
    throw new WidgetError("invalid_config", "That Duolingo username is invalid.");
  }

  const publicUrl = PUBLIC_USER_URL + "?" + new URLSearchParams({ username: username }).toString();
  const publicResponse = await getJsonFn(publicUrl, timeoutMs);
  const users = publicResponse.users;
  if (!Array.isArray(users) || users.length === 0 || typeof users[0] !== "object" || users[0] === null || Array.isArray(users[0])) {
    throw new WidgetError(
      "profile_not_found",
      `Duolingo profile "${displayText(username)}" was not found or is private.`
    );
  }
  const publicProfile = users[0];
  const userId = asInt(publicProfile.id);
  if (userId === null) {
    throw new WidgetError("invalid_response", "Duolingo did not return a user ID.");
  }

  let leaderboard = null;
  const leaderboardUrl = LEADERBOARD_URL + userId + "?" + new URLSearchParams({
    client_unlocked: "true",
    get_reactions: "true"
  }).toString();

  try {
    leaderboard = await getJsonFn(leaderboardUrl, timeoutMs);
  } catch (exc) {
    warnings.push({
      code: "leaderboard_unavailable",
      message: displayText(exc.message) || "Leaderboard request failed",
    });
  }

  return normalizeStats(publicProfile, leaderboard, config, null, warnings);
}

function errorPayload(exc, configured = false) {
  return {
    ok: false,
    configured: configured,
    stale: false,
    error: displayText(exc && exc.message) || "Duolingo request failed.",
    errorCode: firstText(exc && exc.code),
    fetchedAt: "",
  };
}

function expandUser(p) {
  if (p.startsWith("~")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

async function acquireLock(lockPath) {
  const maxRetries = 50;
  const retryInterval = 100;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return true;
    } catch (err) {
      if (err.code === 'EEXIST') {
        try {
          const pid = parseInt(fs.readFileSync(lockPath, 'utf8').trim());
          let alive = false;
          if (pid) {
            try {
              process.kill(pid, 0);
              alive = true;
            } catch (killErr) {
              alive = killErr.code === 'EPERM';
            }
          }
          if (!alive) {
            fs.unlinkSync(lockPath);
            continue;
          }
        } catch (readErr) {}
        await new Promise(resolve => setTimeout(resolve, retryInterval));
      } else {
        throw err;
      }
    }
  }
  return false;
}

function releaseLock(lockPath) {
  try {
    fs.unlinkSync(lockPath);
  } catch (err) {}
}

async function run(args) {
  if (!args.username) {
    return errorPayload(new WidgetError("not_configured", "Add your Duolingo username in settings."), false);
  }

  const config = {
    username: args.username,
    language: args.language || "",
    courseId: args['course-id'] || ""
  };

  const identity = configIdentity(config);
  const cachePath = expandUser(args.cache || defaultCachePath());
  const lockPath = cachePath + ".lock";

  const cacheDir = path.dirname(cachePath);
  fs.mkdirSync(cacheDir, { recursive: true });

  const lockAcquired = await acquireLock(lockPath);
  if (!lockAcquired) {
    return errorPayload(new WidgetError("lock_failed", "Could not acquire file lock."), true);
  }

  try {
    if (!args.force) {
      const maxAge = Math.max(0, parseInt(args['max-age'] !== undefined ? args['max-age'] : 60, 10));
      const cached = loadCache(cachePath, identity, maxAge);
      if (cached !== null) {
        return cached;
      }
    }

    try {
      let timeoutSec = parseFloat(args.timeout !== undefined ? args.timeout : 12.0);
      if (isNaN(timeoutSec)) {
        timeoutSec = 12.0;
      }
      const data = await fetchStats(config, getJson, timeoutSec * 1000);
      saveCache(cachePath, identity, data);
      return data;
    } catch (exc) {
      const stale = loadCache(cachePath, identity);
      if (stale !== null) {
        stale.stale = true;
        stale.error = displayText(exc.message) || "Duolingo request failed.";
        stale.errorCode = firstText(exc.code);
        return sanitizeSnapshot(stale);
      }
      return errorPayload(exc, true);
    }
  } finally {
    releaseLock(lockPath);
  }
}

async function main() {
  const options = {
    cache: { type: 'string' },
    'max-age': { type: 'string' },
    timeout: { type: 'string' },
    force: { type: 'boolean' },
    pretty: { type: 'boolean' },
    username: { type: 'string' },
    language: { type: 'string' },
    'course-id': { type: 'string' }
  };

  let args;
  try {
    const parsed = parseArgs({ options, strict: false });
    args = parsed.values;
  } catch (err) {
    args = {};
  }

  const result = await run(args);
  if (args.pretty) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(JSON.stringify(result));
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  WidgetError,
  asInt,
  nested,
  firstInt,
  firstText,
  displayText,
  sanitizeSnapshot,
  isAllowedUrl,
  parseIsoDate,
  chooseCourse,
  normalizeStreak,
  normalizeLeaderboard,
  normalizeStats,
  configIdentity,
  loadCache,
  saveCache,
  fetchStats,
  getJson,
  run,
};
