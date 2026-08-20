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

test('DisplayText - strips tags and leftover markup delimiters', () => {
  assert.strictEqual(api.displayText('<img src="https://evil.example/x">Ada'), "Ada");
  assert.strictEqual(api.displayText('<b>ada</b>'), "ada");
  assert.strictEqual(api.displayText('<img src="https://evil.example/x"'), 'img src="https://evil.example/x"');
  assert.strictEqual(api.displayText("Ada Learner"), "Ada Learner");
  assert.strictEqual(api.displayText("Ada\u0000Learner"), "AdaLearner");
  assert.strictEqual(api.displayText("A".repeat(250)).length, 200);
});

test('AllowedUrl - only Duolingo HTTPS hosts are accepted', () => {
  assert.strictEqual(api.isAllowedUrl("https://www.duolingo.com/2017-06-30/users?username=ada"), true);
  assert.strictEqual(api.isAllowedUrl("https://duolingo-leaderboards-prod.duolingo.com/leaderboards/x/users/1"), true);
  assert.strictEqual(api.isAllowedUrl("http://www.duolingo.com/2017-06-30/users?username=ada"), false);
  assert.strictEqual(api.isAllowedUrl("https://evil.example/x"), false);
  assert.strictEqual(api.isAllowedUrl("https://www.duolingo.com.evil.example/x"), false);
  assert.strictEqual(api.isAllowedUrl("not a url"), false);
});

test('NormalizeTests - profile markup is stripped from display strings', () => {
  const profile = publicProfile();
  profile.name = '<img src="https://evil.example/x">Ada';
  profile.username = '<b>ada</b>';
  profile.courses[1].title = 'Spanish<img src="https://evil.example/y">';

  const result = api.normalizeStats(
    profile,
    activeLeaderboard(),
    { username: "ada", language: "es" },
    new Date("2026-08-20T12:00:00Z")
  );

  assert.strictEqual(result.profile.name, "Ada");
  assert.strictEqual(result.profile.username, "ada");
  assert.strictEqual(result.course.title, "Spanish");
  assert.ok(!result.profile.name.includes("<"));
  assert.ok(!result.profile.username.includes("<"));
  assert.ok(!result.course.title.includes("<"));
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

test('FetchTests - oversized username is rejected', async () => {
  await assert.rejects(
    api.fetchStats({ username: "a".repeat(65) }, async () => ({})),
    /username is invalid/
  );
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

test('CacheTests - cached profile markup is stripped on load', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "duolingo-tests-"));
  try {
    const cachePath = path.join(tempDir, "stats.json");
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({
      identity: "ada||",
      savedAt: Date.now() / 1000,
      data: {
        ok: true,
        profile: {
          name: '<img src="https://evil.example/x">Ada',
          username: '<b>ada</b>',
        },
        course: { title: 'Spanish<img src="https://evil.example/y">' },
        leaderboard: { league: '<i>Diamond</i>' },
        error: '<script>alert(1)</script>stale',
      },
    }));

    const loaded = api.loadCache(cachePath, "ada||", 60);
    assert.strictEqual(loaded.profile.name, "Ada");
    assert.strictEqual(loaded.profile.username, "ada");
    assert.strictEqual(loaded.course.title, "Spanish");
    assert.strictEqual(loaded.leaderboard.league, "Diamond");
    assert.strictEqual(loaded.error, "alert(1)stale");
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

test('CacheTests - cache directory is created automatically if missing', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "duolingo-tests-"));
  const missingCacheDir = path.join(tempDir, "deeply", "nested", "cache");
  const cachePath = path.join(missingCacheDir, "stats.json");
  
  try {
    const result = await api.run({
      username: "ada",
      cache: cachePath,
      'max-age': 60,
      timeout: 0.01,
      force: true,
    });
    
    assert.strictEqual(fs.existsSync(missingCacheDir), true);
    assert.strictEqual(result.ok, false);
    assert.notStrictEqual(result.errorCode, "ENOENT");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
