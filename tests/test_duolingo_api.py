from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


MODULE_PATH = Path(__file__).parents[1] / "scripts" / "duolingo_api.py"
SPEC = importlib.util.spec_from_file_location("duolingo_api", MODULE_PATH)
assert SPEC and SPEC.loader
api = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(api)


def public_profile(end_date: str = "2026-08-20"):
    return {
        "id": 42,
        "name": "Ada Learner",
        "username": "ada",
        "streak": 37,
        "streakData": {
            "currentStreak": {
                "length": 37,
                "startDate": "2026-07-15",
                "endDate": end_date,
            }
        },
        "totalXp": 98765,
        "learningLanguage": "es",
        "currentCourseId": "DUOLINGO_ES_EN",
        "courses": [
            {
                "id": "DUOLINGO_FR_EN",
                "learningLanguage": "fr",
                "title": "French",
                "xp": 5000,
            },
            {
                "id": "DUOLINGO_ES_EN",
                "learningLanguage": "es",
                "title": "Spanish",
                "xp": 12345,
            },
        ],
    }


def active_leaderboard():
    return {
        "tier": 8,
        "active": {
            "user_id": 42,
            "score": 740,
            "cohort": {
                "tier": 9,
                "rankings": [
                    {"user_id": 7, "score": 900},
                    {"user_id": 42, "score": 740},
                    {"user_id": 8, "score": 600},
                ],
            },
        },
    }


class NormalizeTests(unittest.TestCase):
    def test_completed_today_uses_selected_course(self):
        result = api.normalize_stats(
            public_profile(),
            active_leaderboard(),
            {"username": "ada", "language": "es"},
            today=dt.date(2026, 8, 20),
        )

        self.assertTrue(result["streak"]["todayDone"])
        self.assertFalse(result["streak"]["atRisk"])
        self.assertEqual(result["course"]["title"], "Spanish")
        self.assertEqual(result["courseXp"], 12345)
        self.assertEqual(result["totalXp"], 98765)
        self.assertEqual(result["leaderboard"]["league"], "Diamond")
        self.assertEqual(result["leaderboard"]["position"], 2)
        self.assertEqual(result["leaderboard"]["score"], 740)

    def test_yesterdays_end_date_marks_an_existing_streak_at_risk(self):
        result = api.normalize_stats(
            public_profile("2026-08-19"),
            {"tier": 4},
            {"username": "ada", "courseId": "DUOLINGO_FR_EN"},
            today=dt.date(2026, 8, 20),
        )

        self.assertFalse(result["streak"]["todayDone"])
        self.assertTrue(result["streak"]["atRisk"])
        self.assertEqual(result["course"]["title"], "French")
        self.assertEqual(result["leaderboard"]["league"], "Ruby")

    def test_zero_streak_is_not_presented_as_at_risk(self):
        profile = public_profile("")
        profile["streak"] = 0
        profile["streakData"] = {"currentStreak": None}
        result = api.normalize_stats(
            profile,
            None,
            {"username": "ada"},
            today=dt.date(2026, 8, 20),
        )

        self.assertEqual(result["streak"]["days"], 0)
        self.assertFalse(result["streak"]["todayDone"])
        self.assertFalse(result["streak"]["atRisk"])


class FakeClient:
    def __init__(self, fetch_error=None):
        self.fetch_error = fetch_error
        self.calls = []

    def get_json(self, url):
        self.calls.append(url)
        if "users?" in url:
            if self.fetch_error:
                raise self.fetch_error
            return {"users": [public_profile()]}
        if "duolingo-leaderboards" in url:
            return active_leaderboard()
        return {}


class FetchTests(unittest.TestCase):
    def test_public_mode(self):
        client = FakeClient()
        result = api.fetch_stats({"username": "ada"}, client=client)

        self.assertTrue(result["ok"])
        self.assertTrue(len(client.calls) == 2)
        self.assertEqual(result["leaderboard"]["position"], 2)


class CacheTests(unittest.TestCase):
    def test_missing_config_is_machine_readable(self):
        with tempfile.TemporaryDirectory() as directory:
            args = argparse.Namespace(
                config=str(Path(directory) / "missing.json"),
                cache=str(Path(directory) / "cache.json"),
                max_age=60,
                timeout=1.0,
                force=False,
                pretty=False,
            )
            result = api.run(args)

        self.assertFalse(result["ok"])
        self.assertFalse(result["configured"])
        self.assertEqual(result["errorCode"], "not_configured")

    def test_cache_is_scoped_to_username_and_course(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "stats.json"
            data = {"ok": True, "profile": {"username": "ada"}}
            api.save_cache(path, "ada||es", data)

            self.assertEqual(api.load_cache(path, "ada||es", max_age=60), data)
            self.assertIsNone(api.load_cache(path, "grace||es", max_age=60))


if __name__ == "__main__":
    unittest.main()
