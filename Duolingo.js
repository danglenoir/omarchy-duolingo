#!/usr/bin/env node
/**
 * Fetch and normalize Duolingo profile data for the Omarchy widget.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { parseArgs } = require("node:util");

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
  "Diamond",
];
const USER_AGENT = "Omarchy-Duolingo/1.0.1";
const MAX_DISPLAY_LENGTH = 200;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_COURSES = 256;
const MAX_RANKINGS = 512;
const MAX_USERNAME_LENGTH = 64;
const MAX_LANGUAGE_LENGTH = 32;
const MAX_COURSE_ID_LENGTH = 128;
const MAX_CACHE_BYTES = 256 * 1024;
const MAX_LOCK_BYTES = 1024;
const LOCK_STALE_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 12000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 60000;

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
  } catch {
    return false;
  }
}

function boundedNumber(value, fallback, min, max) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

async function readResponseText(response, maxBytes = MAX_RESPONSE_BYTES) {
  if (!response.body || typeof response.body.getReader !== "function") return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let payload = "";
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new WidgetError("invalid_response", "Duolingo returned an unexpected response.");
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {}
        throw new WidgetError("invalid_response", "Duolingo returned an unexpected response.");
      }
      payload += decoder.decode(value, { stream: true });
    }
    return payload + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function getJson(url, timeoutMs = DEFAULT_TIMEOUT_MS, fetchFn = globalThis.fetch) {
  if (!isAllowedUrl(url)) {
    throw new WidgetError("invalid_response", "Duolingo returned an unexpected response.");
  }

  let response;
  try {
    response = await fetchFn(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(Math.round(boundedNumber(
        timeoutMs,
        DEFAULT_TIMEOUT_MS,
        MIN_TIMEOUT_MS,
        MAX_TIMEOUT_MS
      ))),
    });
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new WidgetError("network_error", "Request to Duolingo timed out.");
    }
    throw new WidgetError("network_error", "Could not reach Duolingo.");
  }

  if (response.status === 401 || response.status === 403) {
    throw new WidgetError("authentication_failed", "Duolingo rejected the request.");
  }
  if (response.status === 404) {
    throw new WidgetError("not_found", "Duolingo could not find that resource.");
  }
  if (response.status === 429) {
    throw new WidgetError("rate_limited", "Duolingo is rate-limiting requests. Try again later.");
  }
  if (!response.ok) {
    throw new WidgetError("api_error", `Duolingo returned HTTP ${response.status}.`);
  }

  const contentLengthHeader = response.headers.get("content-length");
  const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    try {
      await response.body?.cancel();
    } catch {}
    throw new WidgetError("invalid_response", "Duolingo returned an unexpected response.");
  }

  let payload;
  try {
    payload = await readResponseText(response);
  } catch (err) {
    if (err instanceof WidgetError) throw err;
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new WidgetError("network_error", "Request to Duolingo timed out.");
    }
    throw new WidgetError("network_error", "Could not read Duolingo's response.");
  }

  let data;
  try {
    data = JSON.parse(payload);
  } catch {
    throw new WidgetError("invalid_response", "Duolingo returned an unreadable response.");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new WidgetError("invalid_response", "Duolingo returned an unexpected response.");
  }
  return data;
}

function asInt(value) {
  if (value == null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function firstInt(...values) {
  return values.map(asInt).find((value) => value !== null) ?? null;
}

function firstText(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) ?? "";
}

function displayText(...values) {
  const text = firstText(...values)
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/!\[[^\]]*\]\[[^\]]*\]/g, "")
    .replace(/\[[^\]]+\]:\s*\S+/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\b(?:https?|file|data|qrc):\/\/[^\s)]+/gi, "")
    .replace(/(^|[\s(])\/\/[^\s)]+/g, "$1")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > MAX_DISPLAY_LENGTH ? text.slice(0, MAX_DISPLAY_LENGTH) : text;
}

function sanitizeField(obj, key) {
  if (!obj || !Object.hasOwn(obj, key) || obj[key] == null) return;
  obj[key] = displayText(obj[key]);
}

function sanitizeSnapshot(data) {
  if (typeof data !== "object" || data === null) return data;

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
  const text = String(value || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

function chooseCourse(profile, config) {
  const courses = (Array.isArray(profile.courses) ? profile.courses : [])
    .filter((course) => typeof course === "object" && course !== null)
    .slice(0, MAX_COURSES);

  const current = typeof profile.currentCourse === "object" && profile.currentCourse !== null
    ? profile.currentCourse
    : null;
  if (current && !courses.some((course) => course.id === current.id)) {
    courses.unshift(current);
  }

  const courseId = firstText(config.courseId, config.course_id);
  const language = firstText(config.language, config.course).toLowerCase();
  const currentId = firstText(profile.currentCourseId, current?.id);
  const learningLanguage = firstText(profile.learningLanguage, current?.learningLanguage).toLowerCase();

  const selected =
    courses.find((course) => courseId && String(course.id ?? "") === courseId) ||
    courses.find((course) => language && String(course.learningLanguage ?? "").toLowerCase() === language) ||
    courses.find((course) => currentId && String(course.id ?? "") === currentId) ||
    courses.find((course) => learningLanguage && String(course.learningLanguage ?? "").toLowerCase() === learningLanguage) ||
    courses.reduce(
      (best, course) => ((asInt(course.xp) || 0) > (asInt(best?.xp) || 0) ? course : best),
      courses[0]
    ) ||
    {};

  const code = firstText(selected.learningLanguage, language, learningLanguage);
  return {
    id: firstText(selected.id, courseId),
    language: code,
    title: displayText(selected.title, code ? code.toUpperCase() : "Current course"),
    xp: asInt(selected.xp),
  };
}

function normalizeStreak(profile, today) {
  const raw = profile?.streakData?.currentStreak;
  const current = typeof raw === "object" && raw !== null ? raw : {};
  const days = Math.max(0, firstInt(current.length, profile.streak, 0) || 0);
  const endDate = parseIsoDate(current.endDate);
  const todayDone = endDate !== null && endDate.getTime() >= today.getTime();

  return {
    days,
    lastDate: endDate ? endDate.toISOString().slice(0, 10) : "",
    todayDone,
    atRisk: days > 0 && !todayDone,
  };
}

function normalizeLeaderboard(raw, userId) {
  const data = typeof raw === "object" && raw !== null ? raw : {};
  const board = typeof data.leaderboard === "object" && data.leaderboard !== null ? data.leaderboard : data;
  const active = typeof board.active === "object" && board.active !== null ? board.active : null;
  const cohort = active && typeof active.cohort === "object" && active.cohort !== null ? active.cohort : {};
  const tier = firstInt(cohort.tier, active?.tier, board.tier, data.tier);
  const league = tier !== null && tier >= 0 && tier < LEAGUES.length ? LEAGUES[tier] : "Unranked";
  const rankings = Array.isArray(cohort.rankings) ? cohort.rankings.slice(0, MAX_RANKINGS) : [];

  const index = rankings.findIndex((row) => (
    typeof row === "object" &&
    row !== null &&
    userId !== null &&
    firstInt(row.user_id, row.userId) === userId
  ));

  let standing = index >= 0 ? rankings[index] : null;
  let position = index >= 0 ? index + 1 : null;

  if (standing === null && active && userId !== null && firstInt(active.user_id, active.userId) === userId) {
    standing = active;
    const rawRank = firstInt(active.rank);
    if (rawRank !== null) position = rawRank + 1;
  }

  return {
    league,
    tier,
    position,
    score: firstInt(standing?.score, active?.score),
    active: active !== null,
  };
}

function normalizeStats(profile, leaderboard, config, today = null, warnings = null) {
  const now = today || new Date();
  const todayZero = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const course = chooseCourse(profile, config);

  return sanitizeSnapshot({
    ok: true,
    configured: true,
    stale: false,
    error: "",
    errorCode: "",
    fetchedAt: new Date().toISOString(),
    profile: {
      id: asInt(profile.id),
      name: displayText(profile.name, profile.username, config.username),
      username: displayText(profile.username, config.username),
    },
    course,
    streak: normalizeStreak(profile, todayZero),
    courseXp: course.xp,
    totalXp: asInt(profile.totalXp),
    leaderboard: normalizeLeaderboard(leaderboard, asInt(profile.id)),
    warnings: Array.isArray(warnings) ? warnings : [],
  });
}

function defaultCachePath() {
  const cacheHome = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(cacheHome, "omarchy-duolingo", "stats.json");
}

function configIdentity(config) {
  return [
    firstText(config.username).toLowerCase(),
    firstText(config.courseId, config.course_id).toLowerCase(),
    firstText(config.language, config.course).toLowerCase(),
  ].join("|");
}

function readBoundedRegularFile(filePath, maxBytes) {
  const flags = fs.constants.O_RDONLY |
    (fs.constants.O_NOFOLLOW || 0) |
    (fs.constants.O_NONBLOCK || 0);
  const fd = fs.openSync(filePath, flags);

  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) return null;

    const chunks = [];
    let totalBytes = 0;
    while (totalBytes <= maxBytes) {
      const buffer = Buffer.allocUnsafe(Math.min(16 * 1024, maxBytes + 1 - totalBytes));
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > maxBytes) return null;
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, totalBytes).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function loadCache(cachePath, identity, maxAge = null) {
  try {
    const raw = readBoundedRegularFile(cachePath, MAX_CACHE_BYTES);
    if (raw === null) return null;
    const wrapper = JSON.parse(raw);
    if (typeof wrapper !== "object" || wrapper === null || wrapper.identity !== identity) {
      return null;
    }
    const savedAt = Number.parseFloat(wrapper.savedAt || 0);
    if (maxAge !== null && Date.now() / 1000 - savedAt > maxAge) {
      return null;
    }
    const data = wrapper.data;
    return typeof data === "object" && data !== null && data.ok === true
      ? sanitizeSnapshot(data)
      : null;
  } catch {
    return null;
  }
}

function saveCache(cachePath, identity, data) {
  const dir = path.dirname(cachePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const wrapper = {
    identity,
    savedAt: Date.now() / 1000,
    data: sanitizeSnapshot(data),
  };

  const tempPath = path.join(dir, `.stats-${randomUUID()}.json`);
  try {
    fs.writeFileSync(tempPath, JSON.stringify(wrapper), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(tempPath, cachePath);
  } catch (err) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {}
    throw err;
  }
}

async function fetchStats(config, getJsonFn = getJson, timeoutMs = 12000) {
  const username = firstText(config.username);
  if (!username || username.length > MAX_USERNAME_LENGTH) {
    throw new WidgetError("invalid_config", "That Duolingo username is invalid.");
  }
  if (
    firstText(config.language).length > MAX_LANGUAGE_LENGTH ||
    firstText(config.courseId, config.course_id).length > MAX_COURSE_ID_LENGTH
  ) {
    throw new WidgetError("invalid_config", "That Duolingo course selection is invalid.");
  }

  const publicUrl = `${PUBLIC_USER_URL}?${new URLSearchParams({ username })}`;
  const publicResponse = await getJsonFn(publicUrl, timeoutMs);
  const users = publicResponse.users;
  if (!Array.isArray(users) || typeof users[0] !== "object" || users[0] === null || Array.isArray(users[0])) {
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

  const warnings = [];
  let leaderboard = null;
  const leaderboardUrl = `${LEADERBOARD_URL}${userId}?${new URLSearchParams({
    client_unlocked: "true",
    get_reactions: "true",
  })}`;

  try {
    leaderboard = await getJsonFn(leaderboardUrl, timeoutMs);
  } catch (err) {
    warnings.push({
      code: "leaderboard_unavailable",
      message: displayText(err.message) || "Leaderboard request failed",
    });
  }

  return normalizeStats(publicProfile, leaderboard, config, null, warnings);
}

function errorPayload(err, configured = false) {
  return {
    ok: false,
    configured,
    stale: false,
    error: displayText(err?.message) || "Duolingo request failed.",
    errorCode: firstText(err?.code),
    fetchedAt: "",
  };
}

function expandUser(filePath) {
  return filePath.startsWith("~") ? path.join(os.homedir(), filePath.slice(1)) : filePath;
}

function inspectLock(lockPath) {
  let stat;
  try {
    stat = fs.lstatSync(lockPath);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }

  const inspection = {
    identity: { dev: stat.dev, ino: stat.ino },
    record: null,
  };
  if (!stat.isFile()) return inspection;

  let raw;
  try {
    raw = readBoundedRegularFile(lockPath, MAX_LOCK_BYTES);
  } catch {
    return inspection;
  }
  if (raw === null) return inspection;

  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Number.isSafeInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.token === "string" &&
      parsed.token.length > 0 &&
      parsed.token.length <= 128 &&
      Number.isFinite(parsed.createdAt)
    ) {
      inspection.record = parsed;
      return inspection;
    }
  } catch {}

  const legacyPid = Number(raw.trim());
  if (Number.isSafeInteger(legacyPid) && legacyPid > 0) {
    inspection.record = {
      pid: legacyPid,
      token: "",
      createdAt: stat.mtimeMs,
    };
  }
  return inspection;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function lockIsStale(inspection, now = Date.now()) {
  const record = inspection && inspection.record;
  if (!record) return true;
  if (record.createdAt > now + 60000 || now - record.createdAt > LOCK_STALE_MS) return true;
  return !processIsAlive(record.pid);
}

function removeLockIfUnchanged(lockPath, inspection) {
  try {
    const current = fs.lstatSync(lockPath);
    if (current.dev !== inspection.identity.dev || current.ino !== inspection.identity.ino) return false;
    fs.unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

async function acquireLock(lockPath) {
  const token = randomUUID();
  const record = JSON.stringify({ pid: process.pid, token, createdAt: Date.now() });

  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      fs.writeFileSync(lockPath, record, { flag: "wx", mode: 0o600 });
      return token;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;

      const inspection = inspectLock(lockPath);
      if (inspection === null) continue;
      if (lockIsStale(inspection) && removeLockIfUnchanged(lockPath, inspection)) continue;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return null;
}

function releaseLock(lockPath, token) {
  try {
    const inspection = inspectLock(lockPath);
    if (!inspection || !inspection.record || inspection.record.token !== token) return false;
    return removeLockIfUnchanged(lockPath, inspection);
  } catch {
    return false;
  }
}

async function run(args, getJsonFn = getJson) {
  if (!args.username) {
    return errorPayload(new WidgetError("not_configured", "Add your Duolingo username in settings."), false);
  }

  const config = {
    username: args.username,
    language: args.language || "",
    courseId: args["course-id"] || "",
  };

  const identity = configIdentity(config);
  const cachePath = expandUser(args.cache || defaultCachePath());
  const lockPath = `${cachePath}.lock`;
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true, mode: 0o700 });
  } catch {
    return errorPayload(new WidgetError("cache_error", "Could not prepare the local cache."), true);
  }

  let lockToken;
  try {
    lockToken = await acquireLock(lockPath);
  } catch {
    return errorPayload(new WidgetError("cache_error", "Could not access the local cache lock."), true);
  }
  if (lockToken === null) {
    return errorPayload(new WidgetError("lock_failed", "Could not acquire file lock."), true);
  }

  try {
    if (!args.force) {
      const maxAge = Math.floor(boundedNumber(args["max-age"], 60, 0, 24 * 60 * 60));
      const cached = loadCache(cachePath, identity, maxAge);
      if (cached !== null) return cached;
    }

    try {
      const timeoutMs = Math.round(boundedNumber(args.timeout, 12, 0.1, 60) * 1000);
      const data = await fetchStats(
        config,
        getJsonFn,
        timeoutMs
      );
      saveCache(cachePath, identity, data);
      return data;
    } catch (err) {
      const stale = loadCache(cachePath, identity);
      if (stale !== null) {
        stale.stale = true;
        stale.error = displayText(err.message) || "Duolingo request failed.";
        stale.errorCode = firstText(err.code);
        return sanitizeSnapshot(stale);
      }
      return errorPayload(err, true);
    }
  } finally {
    releaseLock(lockPath, lockToken);
  }
}

async function main() {
  let args = {};
  try {
    args = parseArgs({
      options: {
        cache: { type: "string" },
        "max-age": { type: "string" },
        timeout: { type: "string" },
        force: { type: "boolean" },
        pretty: { type: "boolean" },
        username: { type: "string" },
        language: { type: "string" },
        "course-id": { type: "string" },
      },
      strict: false,
    }).values;
  } catch {}

  const result = await run(args);
  console.log(args.pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  WidgetError,
  asInt,
  firstInt,
  firstText,
  displayText,
  sanitizeSnapshot,
  isAllowedUrl,
  readResponseText,
  parseIsoDate,
  chooseCourse,
  normalizeStreak,
  normalizeLeaderboard,
  normalizeStats,
  configIdentity,
  readBoundedRegularFile,
  loadCache,
  saveCache,
  acquireLock,
  releaseLock,
  fetchStats,
  getJson,
  run,
};
