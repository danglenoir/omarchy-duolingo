const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const api = require('../Duolingo.js');

function publicProfile(endDate = "2026-08-20") {
  return {
    id: 42,
    name: "Ada Learner",
    username: "ada",
    streak: 37,
    streakData: {
      currentStreak: {
        length: 37,
        startDate: "2026-07-15",
        endDate: endDate,
      }
    },
    totalXp: 98765,
    learningLanguage: "es",
    currentCourseId: "DUOLINGO_ES_EN",
    courses: [
      {
        id: "DUOLINGO_FR_EN",
        learningLanguage: "fr",
        title: "French",
        xp: 5000,
      },
      {
        id: "DUOLINGO_ES_EN",
        learningLanguage: "es",
        title: "Spanish",
        xp: 12345,
      },
    ],
  };
}

function activeLeaderboard() {
  return {
    tier: 8,
    active: {
      user_id: 42,
      score: 740,
      cohort: {
        tier: 9,
        rankings: [
          { user_id: 7, score: 900 },
          { user_id: 42, score: 740 },
          { user_id: 8, score: 600 },
        ],
      },
    },
  };
}

test('NormalizeTests - completed today uses selected course', () => {
  const result = api.normalizeStats(
    publicProfile(),
    activeLeaderboard(),
    { username: "ada", language: "es" },
    new Date("2026-08-20T12:00:00Z")
  );

  assert.strictEqual(result.streak.todayDone, true);
  assert.strictEqual(result.streak.atRisk, false);
  assert.strictEqual(result.course.title, "Spanish");
  assert.strictEqual(result.courseXp, 12345);
  assert.strictEqual(result.totalXp, 98765);
  assert.strictEqual(result.leaderboard.league, "Diamond");
  assert.strictEqual(result.leaderboard.position, 2);
  assert.strictEqual(result.leaderboard.score, 740);
});

test('NormalizeTests - yesterdays end date marks an existing streak at risk', () => {
  const result = api.normalizeStats(
    publicProfile("2026-08-19"),
    { tier: 4 },
    { username: "ada", courseId: "DUOLINGO_FR_EN" },
    new Date("2026-08-20T12:00:00Z")
  );

  assert.strictEqual(result.streak.todayDone, false);
  assert.strictEqual(result.streak.atRisk, true);
  assert.strictEqual(result.course.title, "French");
  assert.strictEqual(result.leaderboard.league, "Ruby");
});

test('NormalizeTests - zero streak is not presented as at risk', () => {
  const profile = publicProfile("");
  profile.streak = 0;
  profile.streakData = { currentStreak: null };
  const result = api.normalizeStats(
    profile,
    null,
    { username: "ada" },
    new Date("2026-08-20T12:00:00Z")
  );

  assert.strictEqual(result.streak.days, 0);
  assert.strictEqual(result.streak.todayDone, false);
  assert.strictEqual(result.streak.atRisk, false);
});

test('FetchTests - public mode', async () => {
  const calls = [];
  const fakeGetJson = async (url) => {
    calls.push(url);
    if (url.includes("users?")) {
      return { users: [publicProfile()] };
    }
    if (url.includes("duolingo-leaderboards")) {
      return activeLeaderboard();
    }
    return {};
  };

  const result = await api.fetchStats({ username: "ada" }, fakeGetJson);

  assert.strictEqual(result.ok, true);
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(result.leaderboard.position, 2);
});

test('FetchTests - leaderboard failure is handled as a warning', async () => {
  const fakeGetJson = async (url) => {
    if (url.includes("users?")) {
      return { users: [publicProfile()] };
    }
    if (url.includes("duolingo-leaderboards")) {
      throw new api.WidgetError("api_error", "Leaderboard request failed");
    }
    return {};
  };

  const result = await api.fetchStats({ username: "ada" }, fakeGetJson);

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.warnings.length, 1);
  assert.strictEqual(result.warnings[0].code, "leaderboard_unavailable");
  assert.strictEqual(result.warnings[0].message, "Leaderboard request failed");
  assert.strictEqual(result.leaderboard.league, "Unranked");
});

test('FetchTests - user not found or private profile', async () => {
  const fakeGetJson = async (url) => {
    return { users: [] };
  };

  await assert.rejects(
    api.fetchStats({ username: "private_user" }, fakeGetJson),
    /Duolingo profile "private_user" was not found or is private/
  );
});

test('CacheTests - missing config is machine readable', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "duolingo-tests-"));
  try {
    const args = {
      config: path.join(tempDir, "missing.json"),
      cache: path.join(tempDir, "cache.json"),
      'max-age': 60,
      timeout: 1.0,
      force: false,
    };
    const result = await api.run(args);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.configured, false);
    assert.strictEqual(result.errorCode, "not_configured");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('CacheTests - cache is scoped to username and course', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "duolingo-tests-"));
  try {
    const cachePath = path.join(tempDir, "stats.json");
    const data = { ok: true, profile: { username: "ada" } };
    api.saveCache(cachePath, "ada||es", data);

    assert.deepStrictEqual(api.loadCache(cachePath, "ada||es", 60), data);
    assert.strictEqual(api.loadCache(cachePath, "grace||es", 60), null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('CacheTests - direct argument parameters bypass config files', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "duolingo-tests-"));
  try {
    const result = await api.run({
      username: "ada",
      cache: path.join(tempDir, "cache.json"),
      'max-age': 60,
      timeout: 0.01,
      force: true,
    });
    
    assert.strictEqual(result.ok, false);
    assert.notStrictEqual(result.errorCode, "not_configured");
    assert.notStrictEqual(result.errorCode, "config_unreadable");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
